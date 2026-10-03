---
title: "ReentrantLock 源码分析"
date: 2019-07-24
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - Lock
  - ReentrantLock
domain: Java
---

ReentrantLock 提供独占重入、可中断获取、限时获取和多个 Condition。是否采用它应由所需能力决定；不能只凭名字断言它比 synchronized 更快，也不能把公平模式等同于操作系统调度公平。

本文先说明用法，再沿公平与非公平获取、释放和条件等待理解 [OpenJDK 8u202-b08 实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/ReentrantLock.java)。完整示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。AQS 的排队与取消细节见 [AQS](/aqs/)。

## 先保证成功获取后必定释放

保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`。两个线程各自增 100000 次，实测输出 200000。

```java
package io.allurx;


import java.util.concurrent.locks.ReentrantLock;

/**
 * @author allurx
 */
public class DemoApplication {

    private static int n;

    private static ReentrantLock reentrantLock = new ReentrantLock();

    public static void main(String[] args) throws InterruptedException {
        Thread thread1 = new Thread(new Worker());
        Thread thread2 = new Thread(new Worker());
        thread1.start();
        thread2.start();
        thread1.join();
        thread2.join();
        System.out.println(n);
    }

    static class Worker implements Runnable {

        @Override
        public void run() {
            for (int i = 0; i < 100000; i++) {
                reentrantLock.lock();
                try {
                    n++;
                } finally {
                    reentrantLock.unlock();
                }
            }
        }
    }
}
```

lock 放在 try 前：只有成功获取后才进入需要 unlock 的作用域。tryLock 返回 false 时不能调用 unlock；可重入获取了几次，就需要对应释放几次，最后一次释放才允许其他线程获得锁。

## 获取方法表达不同的等待策略

| 方法 | 未立即获取时 |
| --- | --- |
| lock | 等待，最终获取后保留中断状态 |
| lockInterruptibly | 等待期间响应中断 |
| tryLock | 立即返回 false，不排队等待 |
| tryLock(timeout, unit) | 等待到成功、超时或中断 |

一个程序需要可取消的锁等待，应选择相应方法并处理 InterruptedException；单纯换成 ReentrantLock 再继续调用 lock，并不会自动获得取消行为。

## state 记录重入层数，owner 记录拥有者

[![Java 8 ReentrantLock 的同步器继承关系](./images/sync-class-hierarchy.png)](./images/sync-class-hierarchy.png)

Sync 继承 AQS；NonfairSync 与 FairSync 决定获取策略，共用释放规则。state 为零代表空闲；同一拥有者再次获取时增加计数，不与自己互斥。计数溢出会失败，不能把重入理解为无限资源。

非公平获取在 state 为零时直接 CAS，不先检查等待队列；锁已由当前线程持有时增加计数：

```java
final boolean nonfairTryAcquire(int acquires) {
    final Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    else if (current == getExclusiveOwnerThread()) {
        int nextc = c + acquires;
        if (nextc < 0) // overflow
            throw new Error("Maximum lock count exceeded");
        setState(nextc);
        return true;
    }
    return false;
}
```

NonfairSync.lock 还在入口先尝试一次 CAS，失败后才进入 AQS 获取。新到达线程因此可能越过已有等待者；排队中的线程被唤醒不意味着下一次获取一定归它。

## 公平获取多做前驱检查，但仍允许拥有者重入

FairSync 在空闲状态下先通过 hasQueuedPredecessors 检查是否有排队前驱，再尝试 CAS；当前拥有者仍可直接重入。检查反映队列状态，不是精确测量每个线程的等待时长。

```java
public final boolean hasQueuedPredecessors() {
    Node t = tail;
    Node h = head;
    Node s;
    return h != t &&
        ((s = h.next) == null || s.thread != Thread.currentThread());
}
```

队列入队时可能先更新 tail、后连接 next，所以 h.next 为 null 也需要保守地视作存在前驱。不带超时的 tryLock 明确不遵循公平等待策略，即使锁以公平模式构造，也能在空闲时尝试插队。公平性与吞吐量的取舍应结合真实负载测量。

## 释放到零时才通知后继

```java
protected final boolean tryRelease(int releases) {
    int c = getState() - releases;
    if (Thread.currentThread() != getExclusiveOwnerThread())
        throw new IllegalMonitorStateException();
    boolean free = false;
    if (c == 0) {
        free = true;
        setExclusiveOwnerThread(null);
    }
    setState(c);
    return free;
}
```

非拥有者 unlock 抛 IllegalMonitorStateException。部分释放返回 false，AQS 不据此通知后继；完全释放时清 owner、发布 state 为零，再允许 AQS 安排通知。共享字段的所有访问仍必须遵循同一把锁的协议。

## 多个 Condition 不是多把锁

newCondition 可以把不同业务谓词的等待者分组，但这些 Condition 仍关联同一把 ReentrantLock。await 完整释放重入状态，返回前恢复；signal 选择等待者后，等待者仍要重新获取锁并检查条件。具体转移过程见 [Condition](/condition/)。

## 资料来源

- [ReentrantLock：公平性、tryLock 与条件等待](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)
- [OpenJDK 8u202-b08：完整同步器实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/ReentrantLock.java)
