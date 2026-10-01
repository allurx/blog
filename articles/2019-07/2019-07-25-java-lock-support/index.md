---
title: LockSupport源码分析
date: 2019-07-25
updated: 2026-10-01
id: 2019-07-25-java-lock-support
tags:
  - Java
  - Concurrent
  - Lock
  - LockSupport
domain: Java
---

## 核心结论

`LockSupport` 为每个线程维护至多一个许可：`unpark()` 提供许可，`park()` 消耗许可或等待。通知可以先于等待，但许可不能累加；`park()` 还可能因中断或虚假唤醒返回。因此等待必须围绕业务条件组织，不能把一次返回当作条件已满足的证明。

## 问题与适用范围

本文回答许可如何避免部分先通知后等待的问题，及阻塞对象如何辅助诊断。原文 `Unsafe`、字段偏移和 `parkBlocker` 片段来自未标注精确修订的旧实现。`blocker` 不会被当作对象监视器自动加锁；定时等待也不能保证返回后立即获得 CPU。

<!-- more -->

## Unsafe中的实现

LockSupport阻塞唤醒线程是通过调用Unsafe类中的park，unpark和putObject方法来实现的

```java
public native void park(boolean var1, long var2);

public native void unpark(Object var1);

public native void putObject(Object var1, long var2, Object var4);
```

* park方法中的第一个布尔类型的参数代表是否是绝对时间，它是相对第二个long类型的时间参数，如果时间参数为0的话，线程就会一直被阻塞
* unpark的参数是Thread实例，它的作用是用来唤醒这个被阻塞的线程
* putObject方法中的第一个参数是线程实例，第二个参数是Thread类中的`volatile Object parkBlocker;`在内存的偏移，第三个参数是一个实例对象锁，调用该方法会将Thread中的parkBlocker设置为这个对象。

## 阻塞方法

在LockSupport中一共定义了六个阻塞线程的方法

### public static void park()

```java
public static void park() {
	UNSAFE.park(false, 0L);
}
```

调用该方法的线程会一直被阻塞

### public static void park(Object blocker)

```java
public static void park(Object blocker) {
	Thread t = Thread.currentThread();
	setBlocker(t, blocker);
	UNSAFE.park(false, 0L);
	setBlocker(t, null);
}
```

调用该方法的线程会被阻塞在blocker对象上，是通过内部的setBlocker方法来给当前线程设置parkBlocker的

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

调用该方法的线程会被阻塞指定纳秒的时间，然后自动恢复运行

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

调用该方法的线程会被阻塞在blocker对象上指定纳秒的时间，然后自动恢复运行

### public static void parkUntil(long deadline)

```java
public static void parkUntil(long deadline) {
	UNSAFE.park(true, deadline);
}
```

调用该方法的线程会被阻塞直到指定的时间为止，随即会被自动唤醒，参数deadline是从纪元开始的绝对时间，单位是毫秒

### public static void parkUntil(Object blocker, long deadline)

```java
public static void parkUntil(Object blocker, long deadline) {
    Thread t = Thread.currentThread();
    setBlocker(t, blocker);
    UNSAFE.park(true, deadline);
    setBlocker(t, null);
}
```

调用该方法的线程会被阻塞在blocker对象上直到指定的时间为止，随即会被自动唤醒，参数deadline是从纪元开始的绝对时间，单位是毫秒

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

LockSupport是用于创建锁和其他同步类的基本线程阻塞原语。该类与使用它的每个线程关联一个许可证。这有点类似生产者和消费者的设计理念。当调用park方法的时候（Consumer），当前线程会去获取一个和自身关联的许可证，如果拿不到这个许可证线程就会被阻塞。调用unpark方法的时候（Producer），会给当前线程设置一个许可证。值得注意的一点是unpark方法可以在park方法之前调用，也就是说如果执行顺序为

```java
LockSupport.unpark(Thread.currentThread());
LockSupport.park();
```

这时线程并不会被阻塞，需要调用两次pack方法线程才会被阻塞

```
LockSupport.unpark(Thread.currentThread());
LockSupport.park();
LockSupport.park();
```

以上代码执行后当前线程会被阻塞，说明LockSupport是通过一个许可证来标记线程是否被阻塞的，当然了这个许可证是不能被叠加的，多次调用unpark方法，线程依旧只会拥有一个许可证

```java
LockSupport.unpark(Thread.currentThread());
LockSupport.unpark(Thread.currentThread());
LockSupport.park();
LockSupport.park();
```

此时线程依旧会被阻塞。

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
