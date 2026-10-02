---
title: "LockSupport 源码分析"
date: 2019-07-25
updated: 2026-10-02
tags:
  - Java
  - Concurrent
  - Lock
  - LockSupport
domain: Java
---

`LockSupport` 为每个线程维护至多一个许可：`unpark()` 提供许可，`park()` 消耗许可或等待。通知可以先于等待，但许可不能累加；`park()` 还可能因中断或虚假唤醒返回。因此等待必须围绕业务条件组织，不能把一次返回当作条件已满足的证明。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/LockSupport.java) 分析许可交接与 parkBlocker 的诊断用途。blocker 只记录阻塞原因，不充当监视器锁；超时、中断和虚假唤醒都可能使 park 返回，之后仍需检查业务条件。


## Unsafe中的实现

LockSupport阻塞唤醒线程是通过调用Unsafe类中的park，unpark和putObject方法来实现的

```java
public native void park(boolean var1, long var2);

public native void unpark(Object var1);

public native void putObject(Object var1, long var2, Object var4);
```

* Unsafe.park 的布尔参数区分绝对时间与相对时间；LockSupport.park 使用相对时间零表示不设置超时，但仍可因许可、中断或虚假唤醒返回。
* unpark的参数是Thread实例，它的作用是用来唤醒这个被阻塞的线程
* putObject 把 blocker 写入目标线程的 parkBlocker 字段，供诊断工具读取；这个对象不会因此成为监视器锁。

## 阻塞方法

在LockSupport中一共定义了六个阻塞线程的方法

### public static void park()

```java
public static void park() {
	UNSAFE.park(false, 0L);
}
```

没有许可且未中断时，线程可以等待；许可、中断或虚假唤醒均可能使调用返回。

### public static void park(Object blocker)

```java
public static void park(Object blocker) {
	Thread t = Thread.currentThread();
	setBlocker(t, blocker);
	UNSAFE.park(false, 0L);
	setBlocker(t, null);
}
```

该重载在停车前记录 blocker，返回后清空它。blocker 用于说明等待原因，实际许可仍与线程关联：

```java
private static void setBlocker(Thread t, Object arg) {
	UNSAFE.putObject(t, parkBlockerOffset, arg);
}
```

最终调用的是Unsafe类的putObject方法，设置当前线程的parkBlocker成员变量为arg，然后接着执行`UNSAFE.park(false, 0L);`这行代码后，当前线程就被阻塞在这一行了，在其它线程唤醒当前线程后接着执行`setBlocker(t, null);`这行代码，清除当前线程的parkBlocker

### public static void parkNanos(long nanos)

```java
public static void parkNanos(long nanos) {
	if (nanos > 0)
		UNSAFE.park(false, nanos);
}
```

以 nanos 指定相对等待上限；许可、中断或虚假唤醒可能让调用提前返回，超时也不保证马上获得 CPU。

### public static void parkNanos(Object blocker, long nanos)

```java
public static void parkNanos(Object blocker, long nanos) {
    if (nanos > 0) {
        Thread t = Thread.currentThread();
        setBlocker(t, blocker);
        UNSAFE.park(false, nanos);
        setBlocker(t, null);
    }
}
```

与 parkNanos(nanos) 使用同一等待语义，同时记录用于诊断的 blocker。

### public static void parkUntil(long deadline)

```java
public static void parkUntil(long deadline) {
	UNSAFE.park(true, deadline);
}
```

以从 Unix 纪元起算的毫秒时间戳 deadline 作为等待截止时间。调用仍可能提前返回，实际继续执行取决于调度。

### public static void parkUntil(Object blocker, long deadline)

```java
public static void parkUntil(Object blocker, long deadline) {
    Thread t = Thread.currentThread();
    setBlocker(t, blocker);
    UNSAFE.park(true, deadline);
    setBlocker(t, null);
}
```

与 parkUntil(deadline) 使用同一截止时间语义，同时记录 blocker，不获取 blocker 的监视器。

## 唤醒方法

在LockSupport中只有一个唤醒线程的方法

```java
public static void unpark(Thread thread) {
	if (thread != null)
		UNSAFE.unpark(thread);
}
```

唤醒指定的线程

## 许可证

LockSupport 为每个线程关联至多一个许可。unpark(thread) 向目标线程提供许可；park 消耗当前线程的许可，或在没有许可时等待。unpark 可以先于 park，连续多次 unpark 也不会积累多个许可。以下顺序用于说明许可，不应替代业务条件循环：

```java
LockSupport.unpark(Thread.currentThread());
LockSupport.park();
```

第一个 park 可以消费已有许可并返回；如果没有新的许可，第二个 park 可能等待，但仍可能因中断或虚假唤醒返回。

```
LockSupport.unpark(Thread.currentThread());
LockSupport.park();
LockSupport.park();
```

第二次 park 没有前一次遗留的许可，因此可能等待。许可只记录零或一，不是可累加的计数器。

```java
LockSupport.unpark(Thread.currentThread());
LockSupport.unpark(Thread.currentThread());
LockSupport.park();
LockSupport.park();
```

连续两次 unpark 也只保留一个许可，第二次 park 仍可能等待。

## 例子

```java
package io.allurx;

import java.time.LocalTime;
import java.util.concurrent.locks.LockSupport;

/**
 * @author allurx
 */
public class DemoApplication {

    private static Object lock = new Object();

    public static void main(String[] args) {
        Worker worker = new Worker("worker");
        worker.start();
        LockSupport.parkNanos(2000000000);
        LockSupport.unpark(worker);
        LockSupport.parkNanos(2000000000);
        LockSupport.unpark(worker);
    }

    static class Worker extends Thread {

        Worker(String name) {
            super(name);
        }

        @Override
        public void run() {
            LockSupport.park();
            System.out.println(getName() + "第一次被唤醒" + LocalTime.now());
            LockSupport.park(lock);
            System.out.println(getName() + "第二次被唤醒" + LocalTime.now());
            LockSupport.parkUntil(System.currentTimeMillis() + 2000);
            System.out.println(getName() + "第三次被唤醒" + LocalTime.now());
        }
    }

}
```

控制台输出

```
worker第一次被唤醒15:00:33.282
worker第二次被唤醒15:00:35.231
worker第三次被唤醒15:00:37.231
```

1. 开启一个worker线程，分别通过`park()`，`park(Object blocker)`，`parkUntil(long deadline)`阻塞该线程
2. 在main线程中通过`parkNanos(long nanos)`方法每隔2秒唤醒worker线程

## 总结

LockSupport相比于传统的wait和notify机制能够精确的唤醒具体哪个线程，并且提供的阻塞唤醒方法更为直观可理解。并且它的实现方式是类比生产者消费者模式的，在调用阻塞和唤醒方法时分别需要消费和生产一个许可证。

## 资料来源

- [LockSupport：许可、中断与虚假唤醒](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/LockSupport.html)
