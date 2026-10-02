---
title: 锁算法
date: 2019-07-27
updated: 2026-10-01
tags:
  - Java
  - Concurrent
  - Lock
  - 锁算法
domain: Java
---

## 核心结论

简单自旋锁让所有竞争者反复争用同一状态；CLH 在前驱节点上等待，MCS 则在自身节点上等待并由前驱交接。队列结构改变了竞争和通信方式，但自旋仍会消耗 CPU，是否合适取决于持锁时间、竞争程度与硬件，不能只凭算法名称判断性能。

## 问题与适用范围

本文回答三类自旋锁的等待与交接过程。代码用于解释算法，未实现重入、超时、中断、取消与完整的错误使用检查，不能作为通用生产锁。`AtomicReference` 保证原子操作和内存语义，不能独立保证整个自定义锁协议正确；常规业务优先使用成熟同步工具。

<!-- more -->

## 自旋锁（spin lock）

自旋锁是指当一个线程尝试获取某个锁时，如果该锁已被其他线程占用，就一直循环检测锁是否被释放，而不是进入线程挂起或睡眠状态。自旋锁适用于锁保护的临界区很小的情况，临界区很小的话，锁占用的时间就很短。

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

SpinLock是一个简单的自旋锁的实现（CAS操作），上锁时通过AtomicReference原子性的设置当前拥有锁的线程，如果设置失败当前线程就会一直自旋（通过死循环不停的尝试设置，直到成功为止），解锁时通过AtomicReference原子性的清除当前拥有锁的线程。这种实现很简单，但是它存在很明显的缺点

1. 非公平锁，不能保证线程获取锁的顺序
2. 频繁的CAS操作，系统开销很大

## CLH锁

CLH指的是设计锁算法的三位作者：Craig、Landin和Hagersten名字首字母的缩写。CLH锁是一种基于链表的可伸缩、高性能、FIFO、公平的自旋锁。申请锁的线程只在局部变量上自旋，它不断轮询前驱的状态，如果发现前驱释放了锁就结束自旋。

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

### lock

1. 构造当前线程关联的Node，设置到ThreadLocal中
2. 通过CAS设置当前线程的Node到链表尾部并返回前一个在尾部的Node（前一个线程关联的Node）
3. 当前线程在前驱节点上自旋

### unlock

设置自身的`locked = false`，相当于通知下一个线程开始运行

## MCS锁

MCS指的是设计锁算法的两位作者：John Mellor-Crummey and Michael Scott名字的字母的缩写。MCS锁同样是一种基于链表的可伸缩、高性能、FIFO、公平的自旋锁。

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

### lock

1. 构造当前线程关联的Node，设置到ThreadLocal中
2. 通过CAS设置当前线程的Node到链表尾部并返回前一个在尾部的Node（前一个线程关联的Node）
3. 判断是否已经有其它线程往尾部添加过Node了，如果有的话设置当前线程locked为true使其自旋，然后将前驱节点的next属性指向当前线程的Node形成链表结构
4. 当前线程在自身的局部变量上自旋

### unlock

1. 拿到当前线程Node中的next属性（指向下一个线程的Node）
2. 判断是否有下一个节点（有没有其它线程往链表尾部设置过Node）
   * 如果next为null，说明这个时候当前线程的Node在链表尾部，接着调用CAS清空链表尾部，注意如果CAS成功说明当前线程Node的确就在链表尾部那么解锁方法立即返回。但如果CAS失败意味着这个时候有其它线程调用了`Node previousThreadNode = tail.getAndSet(currentThreadNode);`这行代码，但是有可能这个线程仅仅只是执行到这一步还没来得及执行下一步的` previousThreadNode.next = currentThreadNode;`这行代码将前驱节点的next指向自己的Node，所以这个时候解锁方法需要自旋等待其它线程设置next的值（形成链表结构）。所以最终在并发的情况下可能会发生以下两种情况
     * next节点的确为null，说明当前只有一个线程在运行，解锁方法直接返回
     * 有其它线程往链表尾部添加Node，那么就自旋直到其它线程把前驱节点的next设置好（while自旋）
   * 如果next不为null也有以下两种情况
     * next节点的确不为null，说明此时其它线程已经设置好前驱节点的next了，那么直接设置`next.locked = false`通知下一个线程运行即可
     * next节点一开始为null后来通过while自旋被设置的

## CLH锁和MCS锁对比

1. MCS锁每个Node都持有实际指向下一个链表节点的引用，CLH锁没有实际的链表引用，它是通过CAS的返回值拿到上一个节点引用的。
2. MCS锁加锁时是在自身节点的局部变量上自旋，解锁时在线程竞争激烈的情况下会发生自旋。CLH锁加锁时是在前驱节点的属性上自旋，解锁时不会发生自旋。
3. CLH相比较于MCH锁的实现比较简单。
4. CLH锁适合SMP（Symmetric Multi-Processor）系统架构。MCS锁适合NUMA(Non-Uniform Memory Access)系统架构。关于这两个架构的不同之处感兴趣的同学可以自己去查阅相关资料。

## 资料来源

- [AtomicReference：原子比较与交换](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html)
- [ReentrantLock：成熟锁的功能与契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)
