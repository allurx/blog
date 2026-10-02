---
title: "ScheduledThreadPoolExecutor 原理"
date: 2020-05-01
updated: 2026-10-02
tags:
  - Java
  - Concurrent
  - ThreadPoolExecutor
  - ScheduledThreadPoolExecutor
  - ScheduledThreadPoolExecutor原理
domain: Java
---

`ScheduledThreadPoolExecutor` 使用延迟队列安排任务，调度时间表示任务最早可执行的时刻，不保证准点开始。固定频率按预定时间序列安排，固定延迟从上次完成后计时；同一个周期任务不会重叠执行，某次执行抛出异常后会停止后续周期执行。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/ScheduledThreadPoolExecutor.java) 分析延迟任务、周期任务、最小堆及 Leader-Follower 等待机制。无界延迟队列使 maximumPoolSize 不产生通常的扩容效果，调度并行度主要由 corePoolSize 控制。


## 例子

在文章的开头我们先通过一个简单的例子来了解一下如何使用ScheduledThreadPoolExecutor

```java
package io.allurx;

import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;

/**
 * @author allurx
 */
@Slf4j
public class ScheduledThreadPoolExecutorDemo {

    /**
     * ScheduledThreadPoolExecutor使用corePoolSize作为固定大小线程池，内部的延迟队列是一个无界队列，
     * 所以在在设置ScheduledThreadPoolExecutor的corePoolSize大小时需要注意自己有几个延迟任务需要执行，
     * 如果有4个任务的话就设置值为4，如果设置为3的话，那么很有可能第四个任务会等到其它任务执行完毕之后才能执行。
     */
    private static ScheduledThreadPoolExecutor scheduledThreadPoolExecutor = new ScheduledThreadPoolExecutor(4);

    /**
     * 因为{@link ScheduledThreadPoolExecutor}会将我们提交的任务包装成一个继承{@link FutureTask}
     * 的{@code ScheduledFutureTask}，如果延迟任务执行过程中发生异常的话是不会被抛出来的，我们只能通过
     * {@link FutureTask#get()}方法来使其抛出异常，并且这个get方法会阻塞当前执行线程，为了不阻塞main线程
     * 以便调试，我们利用另一个线程池来执行每个延迟任务。
     */
    private static ExecutorService threadPoolExecutor = Executors.newFixedThreadPool(4);

    public static void main(String[] args) {
        threadPoolExecutor.execute(ScheduledThreadPoolExecutorDemo::delayRunnable);
        threadPoolExecutor.execute(ScheduledThreadPoolExecutorDemo::delayCallable);
        threadPoolExecutor.execute(ScheduledThreadPoolExecutorDemo::fixedRateRunnable);
        threadPoolExecutor.execute(ScheduledThreadPoolExecutorDemo::fixedDelayRunnable);
    }

    /**
     * 延迟2秒后执行耗时2s的Runnable任务
     */
    @SneakyThrows
    private static void delayRunnable() {
        scheduledThreadPoolExecutor.schedule(() -> {
            log.info("延迟2秒的Runnable任务开始执行");
            LockSupport.parkNanos(TimeUnit.SECONDS.toNanos(2));
            log.info("延迟2秒的Runnable任务执行完毕");
        }, 2, TimeUnit.SECONDS);
    }

    /**
     * 延迟2秒后执行耗时2s的Callable任务
     */
    @SneakyThrows
    private static void delayCallable() {
        scheduledThreadPoolExecutor.schedule(() -> {
            log.info("延迟2秒的Callable任务开始执行");
            LockSupport.parkNanos(TimeUnit.SECONDS.toNanos(2));
            log.info("延迟2秒的Callable任务执行完毕");
            return null;
        }, 2, TimeUnit.SECONDS);
    }

    /**
     * 初始延迟1秒后执行耗时4秒的Runnable任务，然后在一次任务的终止与下一次开始之间以固定的延迟2秒循环执行
     */
    @SneakyThrows
    private static void fixedDelayRunnable() {
        scheduledThreadPoolExecutor.scheduleWithFixedDelay(() -> {
            log.info("固定delay为2秒的Runnable任务开始执行");
            LockSupport.parkNanos(TimeUnit.SECONDS.toNanos(4));
            log.info("固定delay为2秒的Runnable任务执行完毕");
        }, 1, 2, TimeUnit.SECONDS).get();
    }

    /**
     * 初始延迟1秒后执行耗时4秒的Runnable任务，然后每隔2秒则再次执行这个任务，需要注意的是如果2秒内这个任务没有完成的话，
     * 那么就会等待任务执行完毕后立马执行该任务，也就是说任务不一定每隔2秒就会被执行，任务执行的时机取决于任务本身的执行时长。
     */
    @SneakyThrows
    private static void fixedRateRunnable() {
        AtomicInteger i = new AtomicInteger();
        scheduledThreadPoolExecutor.scheduleAtFixedRate(() -> {
            i.getAndIncrement();

            // 模拟第四次执行时发生异常
            if (i.get() == 4) {
                throw new RuntimeException();
            }
            log.info("固定Rate为2秒的Runnable任务开始执行");
            LockSupport.parkNanos(TimeUnit.SECONDS.toNanos(1));
            log.info("固定Rate为2秒的Runnable任务执行完毕");
        }, 1, 2, TimeUnit.SECONDS).get();
    }

}
```

上面的例子分别通过delayRunnable、delayCallable、fixedDelayRunnable、fixedRateRunnable这四个方法来演示了如何通过ScheduledThreadPoolExecutor来对任务进行调度，大家可以将上面的代码拷贝下来观察一下控制台的输出，理解一下这四个方法对应的调度机制。下面我们将深入研究这些调度方法背后实现的原理。

## 调度方法

ScheduledThreadPoolExecutor实现了ScheduledExecutorService接口定义的一些调度方法，我们平时使用ScheduledThreadPoolExecutor时基本上就是通过这些方法来对任务进行调度的。

```java
package java.util.concurrent;

public interface ScheduledExecutorService extends ExecutorService {

    public ScheduledFuture<?> schedule(Runnable command,
                                       long delay, TimeUnit unit);


    public <V> ScheduledFuture<V> schedule(Callable<V> callable,
                                           long delay, TimeUnit unit);

    public ScheduledFuture<?> scheduleAtFixedRate(Runnable command,
                                                  long initialDelay,
                                                  long period,
                                                  TimeUnit unit);

    public ScheduledFuture<?> scheduleWithFixedDelay(Runnable command,
                                                     long initialDelay,
                                                     long delay,
                                                     TimeUnit unit);

}

```

下面我们对这些方法的含义解释一下

### schedule(Runnable command,long delay, TimeUnit unit);

这个方法的作用是在指定的delay之后执行command任务，这是一个一次性操作，command只会被执行一次

### schedule(Callable<V> callable, long delay, TimeUnit unit);

与第一个调度方法作用相似，不同之处在于执行的是一个Callable

### scheduleAtFixedRate(Runnable command,long initialDelay,long period,TimeUnit unit);

固定频率的计划时间依次为 initialDelay、initialDelay + period、initialDelay + 2 × period。任务耗时超过周期时，后续执行会延后，但同一个周期任务不会重叠；它可以在工作线程可用时继续执行，不保证完成后立刻获得 CPU。

### scheduleWithFixedDelay(Runnable command,long initialDelay,long delay,                                              TimeUnit unit);

这个方法的作用是在给定的initialDelay之后开始执行command任务，然后在一次任务的终止与下一次开始之间以固定的delay循环执行，说白了就是每次任务执行完毕之后会等待delay之后再次执行。

在ScheduledExecutorService定义的调度方法中我们可以看到每个调度方法返回的都是ScheduledFuture对象，顾名思义这是一个调度任务对象。下面我们就来看一下这个ScheduledFuture对象是什么。

## 调度任务

执行完调度方法后会返回一个调度任务对象，而这个调度任务对象则是以ScheduledFuture的方式所定义。

```java
public interface ScheduledFuture<V> extends Delayed, Future<V> {
}
```

ScheduledFuture继承了Delayed和Future接口，Future接口在之前的文章中我们知道它提供了一些对任务的取消、任务结果获取以及任务状态等判断的定义，而Delayed这个接口从名字上我们大概也能猜到它应该是提供一些对任务延迟属性的定义。

### Delayed

```java
package java.util.concurrent;
public interface Delayed extends Comparable<Delayed> {

    long getDelay(TimeUnit unit);
}
```

Delayed接口的定义很简单，仅仅定义了一个以给定的时间单位获取任务剩余延迟的方法。**即任务还剩多久时间就可以开始执行了。**同时Delayed接口也继承了Comparable接口代表两个延迟对象是能够比较的，不难猜出剩多时间多的任务一般是比剩余时间少的任务大的。（即晚执行）

## ScheduledThreadPoolExecutor

在知道了有哪些调度方法以及调度方法返回的调度任务对象之后，我们心里面已经对ScheduledThreadPoolExecutor的执行机制有了一个初步的了解，下面我们就来看一下ScheduledThreadPoolExecutor内部实现这些调度任务的逻辑，首先我们先看一下它的几个构造器。

### 构造器

ScheduledThreadPoolExecutor一共定义了四个构造器：

```java
public ScheduledThreadPoolExecutor(int corePoolSize) {
        super(corePoolSize, Integer.MAX_VALUE, 0, NANOSECONDS,
              new DelayedWorkQueue());
    }

public ScheduledThreadPoolExecutor(int corePoolSize,
                                   ThreadFactory threadFactory) {
    super(corePoolSize, Integer.MAX_VALUE, 0, NANOSECONDS,
          new DelayedWorkQueue(), threadFactory);
}

public ScheduledThreadPoolExecutor(int corePoolSize,
                                   RejectedExecutionHandler handler) {
    super(corePoolSize, Integer.MAX_VALUE, 0, NANOSECONDS,
          new DelayedWorkQueue(), handler);
}

public ScheduledThreadPoolExecutor(int corePoolSize,
                                   ThreadFactory threadFactory,
                                   RejectedExecutionHandler handler) {
    super(corePoolSize, Integer.MAX_VALUE, 0, NANOSECONDS,
          new DelayedWorkQueue(), threadFactory, handler);
}
```

构造器使用 DelayedWorkQueue 和 Integer.MAX_VALUE 的 maximumPoolSize。队列按需扩容，不会通过“队列已满”触发常规扩容，因此正常并行度由 corePoolSize 控制；但无界并不表示内存无限。ensurePrestart 在工作线程数为零时还会尝试创建一个线程，不能将所有工作线程按固定身份区分为核心或非核心。

### 重写的execute和submit方法

execute和submit方法是ExecutorService和Executor接口定义的执行提交任务的方法，ThreadPoolExecutor已经实现了这些方法，而ScheduledThreadPoolExecutor内部又重写了这些方法，下面我们看一下其内部重写的逻辑：

```java
public void execute(Runnable command) {
    schedule(command, 0, NANOSECONDS);
}

public Future<?> submit(Runnable task) {
    return schedule(task, 0, NANOSECONDS);
}

public <T> Future<T> submit(Runnable task, T result) {
    return schedule(Executors.callable(task, result), 0, NANOSECONDS);
}

public <T> Future<T> submit(Callable<T> task) {
    return schedule(task, 0, NANOSECONDS);
}
```

可以发现，execute和submit方法都调用了ScheduledExecutorService中两个一次性的调度方法，也就是说**通过ScheduledThreadPoolExecutor方法执行execute和submit方法的结果就相当于在延迟0秒后执行这个任务。**下面我们就来看一下ScheduledThreadPoolExecutor内部对这些调度方法的具体实现。

### 调度方法的实现

在开始分析调度方法的实现前我们需要先了解一下上面我们提到的调度任务ScheduledFuture的实现，在ScheduledThreadPoolExecutor内部有一个名为ScheduledFutureTask的类定义如下：

#### ScheduledFutureTask

```java
private class ScheduledFutureTask<V> extends FutureTask<V> implements RunnableScheduledFuture<V> {
            ......
}
```

ScheduledFutureTask继承了FutureTask实现了RunnableScheduledFuture接口，不了解FutureTask的同学可以看我之前写的文章。这个RunnableScheduledFuture是什么东西呢？

```java
public interface RunnableScheduledFuture<V> extends RunnableFuture<V>, ScheduledFuture<V> {

    boolean isPeriodic();
}
```

RunnableScheduledFuture接口继承了RunnableFuture接口使自身成为了一个Runnable对象，同时也继承了ScheduledFuture对象使自身成为了一个能够调度的任务对象。内部仅仅定义了一个isPeriodic方法，判断任务本身是否是一个周期性任务。

ScheduledFuture 只向调用者暴露结果、取消和延迟信息；执行器内部还需要可执行入口和周期标记，因此 RunnableScheduledFuture 再组合 RunnableFuture 与 isPeriodic。公开返回的结果句柄无需让使用者承担执行任务的职责。

现在我们知道内部类ScheduledFutureTask是一个继承FutureTask的能够运行的Runnable，同时本身也是一个延迟对象，能够通过Delayed的getDelay方法来获取剩余执行的时间和RunnableScheduledFuture的isPeriodic方法来表明自身是否是一个周期任务。下面我们详细看一下这个ScheduledFutureTask类内部的定义：

```java
private class ScheduledFutureTask<V>
            extends FutureTask<V> implements RunnableScheduledFuture<V> {

        // 当前任务进入队列的顺序
        private final long sequenceNumber;

        // 任务将在多久后开始执行
        private long time;

         // 执行任务的周期时间。
         // 正数代表该任务是fixed-rate类型的任务
         // 负数代表任务是fixed-delay类型的任务
         // 0代表任务是一次性执行的任务
        private final long period;

       // 任务自身引用，当周期任务执行完毕后以便调用reExecutePeriodic方法重新将该任务入队
        RunnableScheduledFuture<V> outerTask = this;

        // 任务在堆中的索引
        int heapIndex;

        // 一次性任务构造器
        ScheduledFutureTask(Runnable r, V result, long ns) {
            super(r, result);
            this.time = ns;
            this.period = 0;
            this.sequenceNumber = sequencer.getAndIncrement();
        }

        // 周期任务构造器
        ScheduledFutureTask(Runnable r, V result, long ns, long period) {
            super(r, result);
            this.time = ns;
            this.period = period;
            this.sequenceNumber = sequencer.getAndIncrement();
        }

       // 一次性任务构造器
        ScheduledFutureTask(Callable<V> callable, long ns) {
            super(callable);
            this.time = ns;
            this.period = 0;
            this.sequenceNumber = sequencer.getAndIncrement();
        }

		// 计算当前任务还剩多久时间能够执行
        public long getDelay(TimeUnit unit) {
            return unit.convert(time - now(), NANOSECONDS);
        }

	   // 在任务入队时会通过这个compareTo方法来对任务执行的优先级进行比较
        public int compareTo(Delayed other) {
            if (other == this) // compare zero if same object
                return 0;
             // 对于ScheduledFutureTask类型的任务首先比较的是它们的
             // 执行时间time，值越小代表越快要执行，反之则代表越晚执行。
             // 如果time相等的话则比较这两个任务入队的顺序，先入队的先执行
            if (other instanceof ScheduledFutureTask) {
                ScheduledFutureTask<?> x = (ScheduledFutureTask<?>)other;
                long diff = time - x.time;
                if (diff < 0)
                    return -1;
                else if (diff > 0)
                    return 1;
                else if (sequenceNumber < x.sequenceNumber)
                    return -1;
                else
                    return 1;
            }
            // 如果任务的类型是用户自己定义的话，则通过getDelay方法来计算任务剩余执行的时间
            // 然后进行比较，越小的值代表越先执行。
            long diff = getDelay(NANOSECONDS) - other.getDelay(NANOSECONDS);
            return (diff < 0) ? -1 : (diff > 0) ? 1 : 0;
        }

        // 判断当前任务是否是周期任务
        public boolean isPeriodic() {
            return period != 0;
        }

        // 周期任务执行完毕后调用这个方法重新设置下一次执行的时间
        private void setNextRunTime() {
            long p = period;
            // 对于fixed-ratey类型的任务来说，下次执行的时间仅仅通过
            // 上次执行的time+p，因为setNextRunTime方法是在
            // FutureTask的runAndReset方法之后被调用的（任务执行完毕后调用），
            // 如果任务执行的时间超过了period，那么这个理论上的time+p在任务被提交到
            // 队列之后的执行优先级就很高
            if (p > 0)
                time += p;
            // 对于fixed-delay类型的任务来说，每次执行的间隔都是固定好的，
            // 所以只需要将|p|+now()就是任务下一次执行的时间
            else
                time = triggerTime(-p);
        }

		// 取消任务
        public boolean cancel(boolean mayInterruptIfRunning) {
            boolean cancelled = super.cancel(mayInterruptIfRunning);
            if (cancelled && removeOnCancel && heapIndex >= 0)
                remove(this);
            return cancelled;
        }

        // 重写FutureTask的run方法逻辑
        public void run() {
            boolean periodic = isPeriodic();
            // 当前是否能够执行任务
            if (!canRunInCurrentRunState(periodic))
                cancel(false);
            // 一次性任务只需要执行一次
            else if (!periodic)
                ScheduledFutureTask.super.run();
            // 周期性任务的执行是通过FutureTask的runAndReset方法执行的
            // 执行完毕之后调用setNextRunTime方法设置下一次执行时间
            // 然后调用reExecutePeriodic方法确保只要当前线程池未关闭则必定
            // 创建一个worker线程来执行提交的任务
            else if (ScheduledFutureTask.super.runAndReset()) {
                setNextRunTime();
                reExecutePeriodic(outerTask);
            }
        }
    }
```

在熟悉了调度任务的具体实现之后，接下来我们再来看一下ScheduledThreadPoolExecutor是如何将Runnable进行调度的。

#### 任务调度

```java

// 指定delay后执行的一次性command
public ScheduledFuture<?> schedule(Runnable command,
                                   long delay,
                                   TimeUnit unit) {
    if (command == null || unit == null)
        throw new NullPointerException();
    RunnableScheduledFuture<?> t = decorateTask(command,
                                                new ScheduledFutureTask<Void>(command, null,
                                                                              triggerTime(delay, unit)));
    delayedExecute(t);
    return t;
}

// 指定delay后执行的一次性Callable
public <V> ScheduledFuture<V> schedule(Callable<V> callable,
                                       long delay,
                                       TimeUnit unit) {
    if (callable == null || unit == null)
        throw new NullPointerException();
    RunnableScheduledFuture<V> t = decorateTask(callable,
                                                new ScheduledFutureTask<V>(callable,
                                                                           triggerTime(delay, unit)));
    delayedExecute(t);
    return t;
}

// 初始化initialDelay后以固定的速率周期执行command
public ScheduledFuture<?> scheduleAtFixedRate(Runnable command,
                                              long initialDelay,
                                              long period,
                                              TimeUnit unit) {
    if (command == null || unit == null)
        throw new NullPointerException();
    if (period <= 0)
        throw new IllegalArgumentException();
    ScheduledFutureTask<Void> sft =
        new ScheduledFutureTask<Void>(command,
                                      null,
                                      triggerTime(initialDelay, unit),
                                      unit.toNanos(period));
    RunnableScheduledFuture<Void> t = decorateTask(command, sft);
    sft.outerTask = t;
    delayedExecute(t);
    return t;
}

// 初始化initialDelay后以固定的延迟周期执行command
public ScheduledFuture<?> scheduleWithFixedDelay(Runnable command,
                                                 long initialDelay,
                                                 long delay,
                                                 TimeUnit unit) {
    if (command == null || unit == null)
        throw new NullPointerException();
    if (delay <= 0)
        throw new IllegalArgumentException();
    ScheduledFutureTask<Void> sft =
        new ScheduledFutureTask<Void>(command,
                                      null,
                                      triggerTime(initialDelay, unit),
                                      unit.toNanos(-delay));
    RunnableScheduledFuture<Void> t = decorateTask(command, sft);
    sft.outerTask = t;
    delayedExecute(t);
    return t;
}
```

在上面的四个调度实现中我们发现其内部的实现大体一致主要分为如下几个步骤

1. 对任务和时间单位的null判断，都周期任务delay值>0判断
2. 通过triggerTime方法计算任务首次执行的时间，然后构造成ScheduledFutureTask任务对象
3. 调用钩子decorateTask方法以便用户能够对任务进行修改和替换
4. 调用delayedExecute方法对任务的执行进行一些提前的操作

##### triggerTime

```java
private long triggerTime(long delay, TimeUnit unit) {
    return triggerTime(unit.toNanos((delay < 0) ? 0 : delay));
}
```

将延迟执行的时间转换为纳秒然后调用triggerTime方法计算任务下次执行的具体时间

```java
long triggerTime(long delay) {
    return now() +
        ((delay < (Long.MAX_VALUE >> 1)) ? delay : overflowFree(delay));
}
```

triggerTime 以 System.nanoTime 的单调时间基准计算触发时刻。较小延迟直接相加；接近 long 上限的延迟交给 overflowFree，避免与队列中已过期任务的时间差超过有符号 long 可比较的范围。

##### overflowFree

```java
private long overflowFree(long delay) {
    Delayed head = (Delayed) super.getQueue().peek();
    if (head != null) {
        long headDelay = head.getDelay(NANOSECONDS);
        if (headDelay < 0 && (delay - headDelay < 0))
            delay = Long.MAX_VALUE + headDelay;
    }
    return delay;
}
```

overflowFree 先检查队头任务的剩余延迟。队头已经过期时 headDelay 为负；新任务延迟又接近 Long.MAX_VALUE 时，`delay - headDelay` 可能溢出，反转 compareTo 的符号。此时把 delay 限制为 `Long.MAX_VALUE + headDelay`，使两者差值仍可比较。队头过期但未出队可能源于工作线程正忙，关键是相对时间差，而不是某次绝对时间相加的数值外观。

计算出任务延迟执行的时间后，接下来则是调用delayedExecute方法对任务的执行进行一些提前的操作。

##### delayedExecute

```java
private void delayedExecute(RunnableScheduledFuture<?> task) {
    if (isShutdown())
        reject(task);
    else {
        super.getQueue().add(task);
        if (isShutdown() &&
            !canRunInCurrentRunState(task.isPeriodic()) &&
            remove(task))
            task.cancel(false);
        else
            ensurePrestart();
    }
}
```

1. 线程池已经关闭的话则拒绝任务

2. 没关闭则将任务提交到队列

   再次判断线程池是否已经关闭（），如果关闭的话继续判断是否应该在线程池关闭之后取消周期和非周期任务

3. 如果线程池没关闭的话则调用ensurePrestart方法确保当前线程池中至少有一个线程

### 小结

ScheduledThreadPoolExecutor继承了ThreadPoolExecutor使自身拥有了线程池的基本功能，不过由于调度任务的特殊性，需要重写execute和submit方法使提交的任务成为一次性执行的任务，同时实现了ScheduledExecutorService接口提供了特殊的任务调度功能。在执行任务调度时内部是将任务封装成一个ScheduledFutureTask对象，提交到最小堆队列中，然后基于线程池任务执行机制和最小堆的特性，每次线程从队列中获取到的都是最先执行的任务。

现在我们已经熟悉了ScheduledThreadPoolExecutor的基本执行流程，而ScheduledThreadPoolExecutor最为核心的点在于其内部的延迟队列。下面我们就来分析一下这个延迟队列的实现。

## DelayedWorkQueue

DelayedWorkQueue 用数组保存最小堆，并在 ScheduledFutureTask.heapIndex 中记录位置。未包装的任务可在 O(1) 时间定位；contains 因此是 O(1)，remove 还需维护堆序，为 O(log n)。通过 decorateTask 包装成其他类型后，定位需要线性扫描，不能继续依赖内部 heapIndex。

```java
// 队列初始化容量为16
private static final int INITIAL_CAPACITY = 16;

// 通过数组来实现堆（二叉树）
private RunnableScheduledFuture<?>[] queue =
    new RunnableScheduledFuture<?>[INITIAL_CAPACITY];

// 操作队列中元素时的独占锁
private final ReentrantLock lock = new ReentrantLock();

// 队列的大小
private int size = 0;

// 当前正在队列头部获取元素的节点
private Thread leader = null;

// 队列头部节点关联的条件
private final Condition available = lock.newCondition();
```

DelayedWorkQueue是一个基于数组实现的最小堆数据结构，在上面的成员变量中有一个leader属性比较特殊，它是Leader-Follower线程模型的一种变体形式，当前正在队列的头部获取元素的线程就是一个Leader，当这个线程获取元素时，其它也尝试从头部获取元素的线程就会阻塞，就相当于Follower，然后当头部节点线程将节点拿出之后就会唤醒下一个Follower，这个Follower此刻就成为了新的Leader，循环往复，这样的好处就是永远只有一个头节点线程是处于定时等待状态，而其他的Follower线程都是处于永久等待状态，避免了多个线程处于定时等待再唤醒再等待的情况。

现在我们已经对DelayedWorkQueue的内部结构和线程如何从队列头部获取任务的机制有了简单的了解，接着我们看一下ThreadPoolExecutor中的线程是如何从队列中获取任务的

```java
private Runnable getTask() {
        boolean timedOut = false; // Did the last poll() time out?

        for (;;) {

			....省略部分代码
            try {
                Runnable r = timed ?
                    workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) :
                    workQueue.take();
                if (r != null)
                    return r;
                timedOut = true;
            } catch (InterruptedException retry) {
                timedOut = false;
            }
        }
    }
```

可以看到通过poll方法来获取带超时时间的任务，而阻塞的获取则是通过take方法来执行的。

我们继续回到ScheduledThreadPoolExecutor的delayedExecute方法中

```java
private void delayedExecute(RunnableScheduledFuture<?> task) {
    if (isShutdown())
        reject(task);
    else {
        super.getQueue().add(task);
        if (isShutdown() &&
            !canRunInCurrentRunState(task.isPeriodic()) &&
            remove(task))
            task.cancel(false);
        else
            ensurePrestart();
    }
}
```

看一看到任务入队是通过队列的add方法来实现的，那接下来我们就通过add和take方法来看一下DelayedWorkQueue内部的实现

### add

```java
public boolean add(Runnable e) {
    return offer(e);
}
```

内部是基于offer方法实现的

```java
public boolean offer(Runnable x) {
    if (x == null)
        throw new NullPointerException();
    RunnableScheduledFuture<?> e = (RunnableScheduledFuture<?>)x;
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        // 队列的大小
        int i = size;
        // 是否需要扩容
        if (i >= queue.length)
            grow();
        // 新增元素后队列的大小加一
        size = i + 1;
        // 如果当前新增的是第一个元素
        if (i == 0) {
            queue[0] = e;
            setIndex(e, 0);
        // 如果当前新增的不是第一个元素，需要通过siftUp
        // 方法来为元素在队列中找到合适的位置
        } else {
            siftUp(i, e);
        }
        // 如果被添加的任务是所有任务中第一个执行的话（数组第一个元素是最早执行的任务）
        // 则需要将当前的leader设置为null，因为此刻这个新加的任务比当前leader正在阻塞等待的任务
        // 要先执行，接着通过signal方法唤醒其中一个正在等待的线程使其从新从队列头部获取这个最新执行的任务
        if (queue[0] == e) {
            leader = null;
            available.signal();
        }
    } finally {
        lock.unlock();
    }
    return true;
}
```

offer方法中最重要的点是非根节点入队时通过siftUp方法来为其找到合适的位置

#### siftUp

```java
private void siftUp(int k, RunnableScheduledFuture<?> key) {
    while (k > 0) {

        // 通过公式floor((i - 1)/2)找到父节点在数组中的索引，无符号右移一位相当于除以2并在高位补0确保为正数，但是这里的效果与有符号的>>1位移是一致的
        int parent = (k - 1) >>> 1;

        // 父节点任务
        RunnableScheduledFuture<?> e = queue[parent];

        // 如果当前加入的任务比父节点任务晚执行，说明该节点已经找到合适位置了跳出循环即可，
        if (key.compareTo(e) >= 0)
            break;

        // 如果当前加入的任务比父节点任务早执行的话则需要将父节点与新任务对调，然后再次循环为这个新任务寻找合适的位置
        queue[k] = e;
        setIndex(e, k);
        k = parent;
    }

    // 走到这一步代表新任务已经找到合适的位置了
    queue[k] = key;
    setIndex(key, k);
}
```

siftUp方法的作用是从索引k位置开始递归为元素在堆中找到合适的位置，如果父节点的值比新加入节点的值大的话，由于最小堆的特性，需要将新节点与父节点替换然后递归直到找到比自身值小的父节点为止，整个过程中节点呈现的是上升趋势。整个siftUp方法的执行流程可以通过下图来表示：

![](./images/min-heap-sift-up.png)

### take

```java
public RunnableScheduledFuture<?> take() throws InterruptedException {
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        for (;;) {
            // 每次都获取最新的头部任务，因为在leader等待任务执行期间可能存在
            // 其它线程新增一个更早执行的任务
            RunnableScheduledFuture<?> first = queue[0];
            // 队列为空的话当前线程阻塞
            if (first == null)
                available.await();
            else {
                // 第一个任务剩余执行的时间
                long delay = first.getDelay(NANOSECONDS);
                // 剩余执行时间小于等于0代表该任务已经可以开始执行了
                if (delay <= 0)
                    return finishPoll(first);
                // 当前任务还不能够开始执行，所以当前线程接下来
                // 需要阻塞直到其可以执行为止，在阻塞期间不要持有这个任务的引用
                first = null; // don't retain ref while waiting

                // 如果当前的leader不为null的话说明已经有其它线程在阻塞等待
                // 第一个任务了，那么当前线程就需要一直阻塞，直到leader将自身唤醒为止
                if (leader != null)
                    available.await();

                // 当前线程是第一个从队列头部获取任务的线程，那么当前线程就可以成为leader了
                else {
                    Thread thisThread = Thread.currentThread();
                    leader = thisThread;
                    try {
                        // 阻塞直到头部任务剩余执行的实现，
                        // 然后就会继续上面的for循环从return中返回
                        available.awaitNanos(delay);
                    } finally {
                        // 醒来后如果当前线程在阻塞期间没有其它线程通过add
                        // 方法新增了一个比当前线程正在等待任务更早执行的任务的话
                        // (add方法会将leader设置为null)，那么当前这个leader在下一次循环中
                        // 就可以返回了，接着就能从所有等待的线程中选出另一个leader了
                        if (leader == thisThread)
                            leader = null;
                    }
                }
            }
        }
    } finally {
        // 执行到这个判断说明已经从队列头部取出最先执行的任务了，
        // 并且只要此刻队列头部存在任务的话则唤醒下一个等待线程使其成为leader
        if (leader == null && queue[0] != null)
            available.signal();
        lock.unlock();
    }
}
```

take方法中最重要的点是leader节点从队列头部取出任务时的finishPoll方法

#### finishPoll

```java
private void siftDown(int k, RunnableScheduledFuture<?> key) {

    // 拥有子节点的节点数
    int half = size >>> 1;

    // 从下标k开始遍历所有拥有子节点的节点
    while (k < half) {

        // 根据公式2i+1找出下标k所对应的左子节点
        int child = (k << 1) + 1;

        // 下标k的左子节点
        RunnableScheduledFuture<?> c = queue[child];

        // 下标k的右子节点下标
        int right = child + 1;

        // 如果存在右子节点并且左子节点比右子节点值大的话则将c赋值为值较小的右子节点，同时将child赋值为右子节点下标
        // 注意这里判断右子节点存在的条件是<size而不是<=size，因为在所有调用siftDown方法的地方都将堆中的最后一个节点赋值为null了，
        // 所以这里判断右子节点是否存在只需要<size即可
        if (right < size && c.compareTo(queue[right]) > 0)
            c = queue[child = right];

        // 将key与这个较小的节点c进行比较，如果key的值比c小或者相等说明key是可以成为下标为k的节点的子节点的，此时跳出循环即可
        if (key.compareTo(c) <= 0)
            break;

        // 如果key比下标k的最小子节点c的值都大的话，说明key不适合呆在这一层，那么接着就继续在节点c的
        // 所有子节点中继续递归寻找合适的位置
        queue[k] = c;
        setIndex(c, k);
        k = child;
    }

    // 走到这一步说明key找到了能够挂靠的父节点或者是到达最底层的叶子节点都没有找到一个合适的位置
    queue[k] = key;
    setIndex(key, k);
}
```

siftDown方法的作用是从索引k位置开始往下最多递归能够拥有子节点的次数，只要找到索引k下的最小的那个子节点值比key还要大，说明key节点是能够成为索引k的子节点的，否则的话将索引k赋值为值最小的那个子节点，然后继续从该最小子节点的索引处往下递归直到将key放在合适的位置位置，整个过程中key节点呈现的是下降趋势。整个siftDown方法的执行流程可以通过下图来表示：

![](./images/min-heap-sift-down.png)

### 小结

DelayedWorkQueue使用数组实现最小堆来保存调度任务，数组中的第一个元素即为最先执行的任务，通过变种的Leader-Follower线程模型来控制线程对调度任务的获取，leader负责阻塞获取队列中最先执行的任务，当任务成功返回或者队列头部被具有更早执行任务替换时都会使当前leader失效（offer方法中失效）并发出一个信号使当前等待的线程中产生出下一个Follower。

## 总结

ScheduledThreadPoolExecutor 将任务封装为带触发时间的 Future，再通过最小堆选择最早到期的任务。正常并行度主要由 corePoolSize 控制，maximumPoolSize 不提供常规扩容；任务到期、工作线程获得任务与实际开始执行是不同时间点。

## 资料来源

- [ScheduledThreadPoolExecutor：周期、异常与队列](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ScheduledThreadPoolExecutor.html)
- [ScheduledExecutorService：固定频率与固定延迟](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ScheduledExecutorService.html)
