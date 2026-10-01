---
title: CountDownLatch源码分析
date: 2019-09-11
updated: 2026-10-01
id: 2019-09-11-java-count-down-latch
tags:
  - Java
  - Concurrent
  - 同步工具
domain: Java
---

## 核心结论

`CountDownLatch` 让等待者在计数降至零后继续执行。计数的是 `countDown()` 调用次数，未必等于线程数量；到零后不能重置。需要等待一组工作完成时，应保证成功、失败等约定路径都会完成相应的计数，否则等待者可能一直无法通过。

## 问题与适用范围

本文回答开工信号与完成信号如何配合，并解释原文 AQS 共享模式实现。旧源码未标注精确 JDK 修订。它不是可循环屏障，也不自动收集任务结果或异常；需要超时或中断响应时使用对应的 `await()` 契约。

<!-- more -->

## 例子

在分析CountDownLatch原理前，我们先来看一下它是如何使用的，下面是类似CountDownLatch类注释上的一个例子

```java
package io.allurx;


import java.time.LocalTime;
import java.util.concurrent.CountDownLatch;

/**
 * @author allurx
 */
public class DemoApplication {

    private static CountDownLatch startSignal = new CountDownLatch(1);
    private static CountDownLatch doneSignal = new CountDownLatch(2);

    public static void main(String[] args) throws InterruptedException {
        System.out.println("main线程开始运行：" + LocalTime.now());
        new Thread(new Worker(), "Worker1").start();
        new Thread(new Worker(), "Worker2").start();
        Thread.sleep(2000);

        // 唤醒两个Worker线程
        startSignal.countDown();

        // 阻塞main线程直到Worker线程执行完毕
        doneSignal.await();
        System.out.println("main线程运行结束：" + LocalTime.now());
    }

    static class Worker implements Runnable {

        @Override
        public void run() {
            try {
                startSignal.await();
                System.out.println(Thread.currentThread().getName() + "开始运行：" + LocalTime.now());
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                e.printStackTrace();
            } finally {
                System.out.println(Thread.currentThread().getName() + "运行结束：" + LocalTime.now());
                doneSignal.countDown();
            }
        }
    }

}
```

控制台输出

```java
main线程开始运行：15:02:52.695
Worker1开始运行：15:02:54.697
Worker2开始运行：15:02:54.697
Worker1运行结束：15:02:56.697
Worker2运行结束：15:02:56.697
main线程运行结束：15:02:56.697
```

在上面的例子中，首先定义了两个CountDownLatch，它们的计数值分别为1和2，然后在主线程中开启两个Worker线程，在run方法中调用startSignal的await方法阻塞Worker线程（因为此刻startSignal的计数值为1），然后主线程睡眠2秒后调用startSignal的countDown方法使计数器减一，最终startSignal的计数值为0，唤醒两个Worker开始运行，接着调用doneSignal的方法阻塞主线程（因为此刻doneSignal的计数值为2），在Worker线程运行结束后调用doneSignal的countDown方法使计数器减一，最终doneSignal的计数值为0，然后主线程被唤醒开始运行。从这上面的例子我们大概能够知道CountDownLatch的使用方法了，通过构造函数传入的计数值来阻塞调用await方法的线程直到计数值被其它线程改变为0，调用await方法的线程才能继续执行。下面我们就来分析一下CountDownLatch内部实现的原理。

## 构造函数

```java
public CountDownLatch(int count) {
    if (count < 0) throw new IllegalArgumentException("count < 0");
    this.sync = new Sync(count);
}
```

CountDownLatch只有一个构造函数其中参数count代表在线程可以通过await之前必须调用countDown的次数。然后构造了一个Sync对象。

## Sync

```java
private static final class Sync extends AbstractQueuedSynchronizer {
    private static final long serialVersionUID = 4982264981922014374L;
	// AQS中的state就是CountDownLatch构造函数传入的数值
    Sync(int count) {
        setState(count);
    }

    int getCount() {
        return getState();
    }
    // 在AQS的acquireSharedInterruptibly方法中我们知道方法返回负数代表
    // 获取锁失败，当前线程需要排队，放到CountDownLatch中代表的就是还未调用countDown
    // 的次数
    protected int tryAcquireShared(int acquires) {
        return (getState() == 0) ? 1 : -1;
    }

    // 在AQS的releaseShared方法中我们知道该方法返回true则代表需要唤醒队列中头部的下一个节点，
    // 每调用一次CountDownLatch的countDown方法，都会通过cas将state值减一，知道state值被某个线程
    // 减到0的时候，这个方法就会返回true，然后AQS中的releaseShared方法就会开始尝试唤醒头部节点的下一个叫节点
    protected boolean tryReleaseShared(int releases) {
        // Decrement count; signal when transition to zero
        for (;;) {
            int c = getState();
            if (c == 0)
                return false;
            int nextc = c-1;
            if (compareAndSetState(c, nextc))
                return nextc == 0;
        }
    }
}
```

Sync重写了AQS中的tryAcquireShared和tryReleaseShared方法，以共享模式获取和释放共享资源。

## await

```java
public void await() throws InterruptedException {
    sync.acquireSharedInterruptibly(1);
}
```

如果调用该方法的线程中断标记已经被设置，那么会立即抛出InterruptedException，否则导致当前线程等待锁存器倒计数到零。如果当前计数为零，则此方法立即返回。如果当前计数大于零，则当前线程将被禁用以进行线程调度。其实现依赖的是AQS的acquireSharedInterruptibly方法。

## countDown

```java
public void countDown() {
    sync.releaseShared(1);
}
```

减少锁存器的计数，如果计数值达到零则唤醒所有等待的线程。如果当前计数值为0，则无任何响应，其实现依赖的是AQS的releaseShared方法。

## 总结

CountDownLatch是基于AQS以共享模式获取和释放锁的一个同步工具类，使用它可以实现基于开关控制的锁流程，调用await方法的线程将会被阻塞直到其它线程调用countDown方法使计数值为0，调用await方法的线程才会继续执行。

## 资料来源

- [CountDownLatch：一次性计数与内存一致性](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html)
