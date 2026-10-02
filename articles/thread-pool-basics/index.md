---
title: "ThreadPoolExecutor 概述"
date: 2020-01-07
updated: 2026-10-02
tags:
  - Java
  - Concurrent
  - ThreadPoolExecutor
  - ThreadPoolExecutor概述
domain: Java
---

`ThreadPoolExecutor` 提交任务时先尝试增加核心工作线程，再尝试入队，队列不能接纳任务时才尝试增加到最大线程数，仍不能接纳则执行拒绝策略。队列类型会直接改变扩容行为：无界队列通常使 `maximumPoolSize` 无法发挥限流作用，容量、线程数与拒绝策略需要一起选择。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/ThreadPoolExecutor.java) 分析线程池参数、运行状态及任务接纳规则。核心线程默认按需创建，也可能允许空闲超时；关闭请求不保证业务任务立即结束，线程数需要结合负载确定。


## 线程池的状态

线程池通过一个AtomicInteger类型的原子变量ctl将workerCount（线程池中的线程数）和runState（线程运行的状态）打包到一个int数值中，为了将它们打包为一个int，将workerCount限制为（2 ^ 29 ）-1（约5亿）个线程，而不是（2 ^ 31）-1（约20亿）是为了将int的高3位代表线程池的状态，低29位代表线程池中的worker数量。同时作者解释使用int而不是long数值的原因是int相比long进行运算更快，更简单，即便将来计算机发展到能够同时开启几十亿甚至上百亿个线程，可以将变量更改为AtomicLong，然后对COUNT_BITS和CAPACITY进行微调即可。

```java
private final AtomicInteger ctl = new AtomicInteger(ctlOf(RUNNING, 0));
private static final int COUNT_BITS = Integer.SIZE - 3;
private static final int CAPACITY   = (1 << COUNT_BITS) - 1;

// int的高3位存储线程池的运行状态
private static final int RUNNING    = -1 << COUNT_BITS;
private static final int SHUTDOWN   =  0 << COUNT_BITS;
private static final int STOP       =  1 << COUNT_BITS;
private static final int TIDYING    =  2 << COUNT_BITS;
private static final int TERMINATED =  3 << COUNT_BITS;

// 计算线程池的运行状态
private static int runStateOf(int c)     { return c & ~CAPACITY; }
// 计算线程池中的worker数量
private static int workerCountOf(int c)  { return c & CAPACITY; }
// 将线程池运行状态和线程池中的worker数量打包到一个int数值中
private static int ctlOf(int rs, int wc) { return rs | wc; }
```

* ctl

  线程池状态与线程池中的线程数量分别被打包到int的高3位和低29位

* COUNT_BITS

  int占4个字节，一个字节八位，一共32位，使用低29位代表线程池的容量

* CAPACITY

  线程池的容量最大为2^29-1，即线程池中最多只会存在2^29-1个线程。

  ```java
  0001 1111 1111 1111 1111 1111 1111 1111‬
  ```

* RUNNING

  线程池被新建后就处于RUNNING状态了，此时线程池能够**接受新任务并处理排队的任务**

  ```java
  1110 0000 0000 0000 0000 0000 0000 0000‬
  ```

* SHUTDOWN

  一般调用shutdown方法后线程池就处于SHUTDOWN状态了，此时线程池**不接受新任务，而是处理之前已提交的任务**

  ```java
  0000 0000 0000 0000 0000 0000 0000 0000‬
  ```

* STOP

  一般调用shutdownNow方法后线程池就处于STOP状态了，此时线程池**不接受新任务，不再处理队列中的待执行任务，尝试中断正在执行的线程，并返回尚未开始的任务。任务是否及时停止取决于它对中断的响应**

  ```java
  0010 0000 0000 0000 0000 0000 0000 0000‬
  ```

* TIDYING

  已停止接收任务，并且满足终止条件时，最后一个 worker 退出才允许转为 TIDYING；SHUTDOWN 还要求队列为空。仅仅 workerCount 为零并不够，例如新建且尚未提交任务的线程池仍处于 RUNNING。随后调用 terminated 钩子。

  ```java
  0100 0000 0000 0000 0000 0000 0000 0000‬
  ```

* TERMINATED

  钩子方法terminated执行完毕后线程池的状态就会变为TERMINATED，此时**线程池会唤醒所有因调用awaitTermination方法而阻塞的线程。**

  ```java
  0110 0000 0000 0000 0000 0000 0000 0000‬
  ```

## 线程池参数

虽然juc提供了一个Executors工具类来帮助我们创建各种类型的线程池，但是我们还是很有必要了解线程池中各个参数含义的。

### corePoolSize

核心线程数量的阈值。默认按需创建，也可预启动；通常不因空闲退出，除非设置 allowCoreThreadTimeOut 为 true，这样的话在经过指定的时间后，核心线程也会被销毁。当通过execute方法提交任务时只要线程池中的线程数量小于corePoolSize，即使其他工作线程处于空闲状态，也会创建一个新线程来处理任务。

### maximumPoolSize

线程池允许的最大工作线程数。任务不能入队时，会尝试在此上限内添加线程；当前线程数等于 corePoolSize 也可以扩容，不必先大于它。线程工厂无法创建线程时仍可能无法接纳任务。

### keepAliveTime

线程池中非核心线程能够阻塞获取任务的最大时间，如果在改时间内还没有获取到任务接下来这个线程就会退出。默认策略只会销毁非核心线程，可以设置allowCoreThreadTimeOut为true使核心线程与非核心线程都在指定空闲的时间后被销毁。

### BlockingQueue

阻塞队列，用来存放提交的任务，即如果核心线程已满的情况下继续通过execute提交任务，这些任务会被放进这个阻塞队列中。有关阻塞队列的使用可以参考我之前写的文章。

### threadFactory

用来创建线程执行提交的任务，可以实现这个接口自定义任务被执行时的线程

```java
package java.util.concurrent;

public interface ThreadFactory {

    Thread newThread(Runnable r);
}
```

如果不指定默认使用的是`Executors.defaultThreadFactory()`

### RejectedExecutionHandler

发生以下两种情况之一则会调用RejectedExecutionHandler的rejectedExecution方法来拒绝执行这个任务

* 通过execute方法提交任务时线程池状态不是RUNNING
* 通过execute方法提交任务时线程池中的线程数已经达到maximumPoolSize并且阻塞队列（存放任务的队列）也满了

ThreadPoolExecutor中内置了四个拒绝执行策略，其中默认的策略是AbortPolicy。

```java
private static final RejectedExecutionHandler defaultHandler =
    new AbortPolicy();
```

#### AbortPolicy

```java
public static class AbortPolicy implements RejectedExecutionHandler {
    public AbortPolicy() { }

    public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
        throw new RejectedExecutionException("Task " + r.toString() +
                                             " rejected from " +
                                             e.toString());
    }
}
```

终止策略，执行抛出RejectedExecutionException

#### CallerRunsPolicy

```java
public static class CallerRunsPolicy implements RejectedExecutionHandler {
    public CallerRunsPolicy() { }

    public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
        if (!e.isShutdown()) {
            r.run();
        }
    }
}
```

在提交任务线程执行策略，只要此时线程池的状态是RUNNING状态则直接在提交任务的线程中执行任务。

#### DiscardOldestPolicy

```java
public static class DiscardOldestPolicy implements RejectedExecutionHandler {
    public DiscardOldestPolicy() { }

    public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
        if (!e.isShutdown()) {
            e.getQueue().poll();
            e.execute(r);
        }
    }
}
```

丢弃队头任务后重新尝试 execute。队头是不是最早提交取决于队列顺序，优先级队列并不满足这个等同关系；线程池已关闭时不重试。

#### DiscardPolicy

```java
public static class DiscardPolicy implements RejectedExecutionHandler {

    public DiscardPolicy() { }

    public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
    }
}
```

直接舍弃策略，什么也不做，直接忽略这个任务。

## 资料来源

- [ThreadPoolExecutor：队列、线程数与拒绝策略](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)
- [ExecutorService：关闭与等待终止](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html)
