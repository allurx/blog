---
title: 从简单自旋到 CLH、MCS：锁怎样交给下一线程
date: 2019-07-27
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - Lock
  - 锁算法
domain: Java
---

线程 A 持有锁时，B、C 都在等待。最直接的办法是让 B、C 不断尝试修改同一个 `owner`，谁先成功谁进入临界区。竞争者更多时，这个位置就会被反复争抢。CLH 和 MCS 换了一种安排：先排队，再由前驱的状态或通知决定后继何时继续。

下面始终围绕这三个线程看两个动作：获取失败后在哪里等待，A 释放时怎样让 B 取得锁。三种实现都采用自旋，因此队列改变了通信方式，却不会消除等待期间的 CPU 消耗。

本文用 Java 25 标准库表达协议，并对照 [原作者维护的 MCS、CLH 伪代码](https://www.cs.rochester.edu/research/synchronization/pseudocode/ss.html)。三个实现已在 Oracle JDK 25.0.2 下编译；它们不提供重入、超时、取消和完整的错误使用检查，也没有进行硬件性能测试，不应直接替代通用生产锁。

## 简单自旋：竞争同一个 owner

```java
package io.allurx;

import java.util.concurrent.atomic.AtomicReference;

/**
 * @author allurx
 */
public class SpinLock {

    private AtomicReference<Thread> owner = new AtomicReference<>();

    public void lock() {
        while (!owner.compareAndSet(null, Thread.currentThread())) {
        }
    }

    public void unlock() {
        owner.compareAndSet(Thread.currentThread(), null);
    }
}
```

获取通过 CAS 把 null 改为当前线程，释放通过 CAS 清除自己拥有的 owner。失败者不断竞争同一个位置，没有排队顺序保证；持锁线程被调度出去时，其他线程仍可能继续消耗 CPU。

它适合说明原子获取的最小结构，不保证总比阻塞锁快。持锁时间、竞争数量、CPU 核心数和线程调度都影响实际成本，不能只凭“没有系统调用”得出性能结论。

## CLH：后继观察前驱何时释放

### 每次入队取得自己的前驱

A、B、C 依次入队后，B 保存 A 的节点，C 保存 B 的节点。B 不再与 C 一起争抢 `owner`，而是反复读取 A 的 `locked`；A 把它改成 `false` 后，B 便可以继续。

```java
package io.allurx;

import java.util.concurrent.atomic.AtomicReference;

/**
 * @author allurx
 */
public class ClhLock {

    /**
     * 当前线程的局部变量，持有当前线程关联的Node
     */
    private ThreadLocal<Node> currentThreadLocal = new ThreadLocal<>();

    /**
     * 链表尾部Node，初始化为null
     */
    private AtomicReference<Node> tail = new AtomicReference<>();

    /**
     * 加锁
     */
    public void lock() {

        // 构造和当前线程关联的Node
        Node currentThreadNode = new Node();

        // 将当前线程关联的Node添加到ThreadLocal中以便解锁时设置locked = false
        currentThreadLocal.set(currentThreadNode);

        // 将当前线程关联的Node原子性的设置到链表尾部,
        // 返回前一个线程关联的Node
        Node previousThreadNode = tail.getAndSet(currentThreadNode);

        // 自旋判断前一个线程关联的Node是否已经解锁
        while (previousThreadNode != null && previousThreadNode.locked) {
        }
    }

    /**
     * 解锁
     */
    public void unlock() {

        // 解锁时释放锁,这样在该线程关联的Node上自旋的下一个线程就能获取锁了
        currentThreadLocal.get().locked = false;
    }

    static class Node {

        // 默认是在等待锁的
        volatile boolean locked = true;
    }
}
```

每次获取创建一个 locked=true 的节点，并通过 getAndSet 原子加入队尾。返回值给出前驱；线程只要观察到前驱 unlocked，就可以进入。释放只把自身 locked 改为 false，让后继观察到交接。

### 节点的生命周期也是协议的一部分

这里的前驱保存在局部引用中，但反复读取的是前驱节点的 `volatile` 字段。示例每轮分配新节点，让 A 的旧节点在 B 结束观察前保持原来的释放状态。若直接把这个节点再次设为等待并入队，仍在观察它的后继就可能看到错误的一轮状态；复用节点需要额外的交接规则，不能只为减少分配替换这一行代码。

## MCS：前驱通知后继的节点

### 显式连接 next，让每个线程观察自身节点

MCS 让 B 读取自己的 `locked`。为了让 A 能通知 B，B 入队后还要把自己写进 A 的 `next`。这一小段显式连接，也是后面释放路径需要处理竞争窗口的原因。

```java
package io.allurx;

import java.util.concurrent.atomic.AtomicReference;

/**
 * @author allurx
 */
public class McsLock {

    /**
     * 当前线程的局部变量，持有当前线程关联的Node
     */
    private ThreadLocal<Node> currentThreadLocal = new ThreadLocal<>();

    /**
     * 链表的尾部Node
     */
    private AtomicReference<Node> tail = new AtomicReference<>();

    /**
     * 加锁
     */
    public void lock() {

        // 构造和当前线程关联的Node
        Node currentThreadNode = new Node();

        // 将当前线程关联的Node添加到ThreadLocal中以便解锁时设置locked = false
        currentThreadLocal.set(currentThreadNode);

        // 将当前线程关联的Node原子性的添加到链表尾部并返回前一个在尾部的Node，也就是前一个线程关联的Node
        Node previousThreadNode = tail.getAndSet(currentThreadNode);

        // 如果已经有线程往链表尾部添加过Node，就将它的Node的next指向当前线程Node，形成链表结构。
        // 并且设置当前线程locked=true，使当前线程自旋直到前一个线程通知当前线程可以运行
        if (previousThreadNode != null) {

            // 使当前线程自旋等待通知
            currentThreadNode.locked = true;

            // 形成链表结构
            previousThreadNode.next = currentThreadNode;
        }

        // 自旋判断自身是否已经被前一个线程解锁
        while (currentThreadNode.locked) {
        }
    }

    /**
     * 解锁
     */
    public void unlock() {

        // 获取和线程自身关联的Node
        Node currentThreadNode = currentThreadLocal.get();

        // 如果还没有其它线程将Node添加到tail
        if (currentThreadNode.next == null) {
            // cas设置tail为null，注意如果cas失败说明这时有另一个线程调用了tail.getAndSet方法
            if (tail.compareAndSet(currentThreadNode, null)) {
                return;
            }
            // 在上一步cas失败后，另一个线程调用了tail.getAndSet方法给tail设置了新的值，有可能还没有来得及
            // 调用previousThreadNode.next = currentThreadNode这段代码，所以此时next可能为null，这个时候自旋
            // 直到next被设置值
            while (currentThreadNode.next == null) {
            }
        }
        // 运行到这一步表明next肯定已经被另一个线程设置值了，设置locked=false，通知下一个线程运行
        currentThreadNode.next.locked = false;
    }

    static class Node {

        // 默认没有处于等待锁的状态
        volatile boolean locked = false;

        // 指向下一个线程的Node
        volatile Node next;
    }
}
```

MCS 显式建立 next 链。后继先设置自己的 locked，再把自己链接到前驱；前驱释放时写后继的 locked=false。等待者反复读取自己的节点，改变了等待期间共享内存通信的位置。

### 释放时处理“已入队，尚未连好”的窗口

假设 B 已执行 `tail.getAndSet`，却在写 `A.next` 之前暂停。此时 A 看到 `next == null`，但队尾已经是 B。A 清空队尾的 CAS 会失败，告诉它有后继正在连接，于是等待 `next` 出现，再把 B 的 `locked` 改为 `false`。如果看到 `next == null` 就直接返回，B 此后即便连好也收不到释放通知。

## 交接方式如何改变竞争成本

| 实现 | 等待位置 | 释放动作 | 主要代价 |
| --- | --- | --- | --- |
| 简单自旋 | 共同 owner | 清除 owner | 竞争集中，获取顺序不保证 |
| CLH | 前驱节点 | 清除自身 locked | 需要正确管理节点生命周期 |
| MCS | 自身节点 | 写后继 locked | 需处理入队已发布、next 尚未连接的窗口 |

原始论文区分缓存一致与非一致机器上的局部自旋能力；NUMA、缓存一致性和对称多处理并不是一组可以直接互换的分类。不能简单规定“CLH 只适合 SMP，MCS 只适合 NUMA”。本例在 JVM 上还受到对象布局、GC 和调度影响，具体结论必须测量。

将三个类保存为 SpinLock.java、ClhLock.java、McsLock.java，可执行 `javac -encoding UTF-8 -d out SpinLock.java ClhLock.java McsLock.java` 检查语法与类型。这些是锁实现类，没有独立 main；编译成功不等于并发协议已经穷尽验证。实际业务优先使用 [ReentrantLock](/reentrant-lock/) 等具有完整等待、取消和诊断能力的实现。

## 资料来源

- [Mellor-Crummey、Scott 等：可扩展同步算法与 CLH 补充](https://www.cs.rochester.edu/research/synchronization/pseudocode/ss.html)
- [AtomicReference：原子交换与内存语义](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html)
