---
title: LinkedBlockingQueue
date: 2020-01-04
updated: 2026-10-02
tags:
  - Java
  - Collection
  - Queue
  - BlockingQueue
  - LinkedBlockingQueue
domain: Java
---

`LinkedBlockingQueue` 是可指定容量的 FIFO 阻塞队列。下面分析的实现通过分别保护入队和出队的锁、共享计数与条件通知协调生产者和消费者，因此部分入队与出队可以并行。未指定容量时上限为 `Integer.MAX_VALUE`，并不意味着实际内存足够。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/LinkedBlockingQueue.java) 为源码基线，分析链表、哨兵节点、容量计数与条件通知的协作。用于任务积压时应明确容量，迭代与批量转移也需要遵守各自的并发契约。


## 链表节点

LinkedBlockingQueue是通过一个静态内部类Node来构成单向链表的。

```java
static class Node<E> {

    E item;

    Node<E> next;

    Node(E x) { item = x; }
}
```

* item代表的是当前节点持有的元素
* next代表的是当前节点的下一个节点

## 成员变量

### 节点

```java
transient Node<E> head;

private transient Node<E> last;
```

* head代表的链表的头部节点
* last代表的链表的尾部节点

在并发的情况下队列会形成如下图所示的链表结构

![](./images/linked-blocking-queue.png)

### 队列容量大小

```java
private final int capacity;

private final AtomicInteger count = new AtomicInteger();
```

* capacity代表的是队列允许存储元素的最大数量
* count代表的是当前队列中的元素个数，因为可能会存在多个线程同时读写队列，所以通过AtomicInteger这个原子类来保证并发情况下能够读取到当前队列中的元素数量

### 锁和监视器

```java
private final ReentrantLock takeLock = new ReentrantLock();

private final Condition notEmpty = takeLock.newCondition();

private final ReentrantLock putLock = new ReentrantLock();

private final Condition notFull = putLock.newCondition();
```

* takeLock代表的是在执行take, poll等**获取操作**时当前线程必须锁持有的锁
* notEmpty代表的是如果在执行take, poll等**获取操作**时如果队列为空，那么当前线程应该阻塞在这个Condition上直到队列不为空为止
* putLock代表的是在执行put, offer等**新增操作**时当前线程必须锁持有的锁
* notFull代表的是如果在执行put, offer等**新增操作**时如果队列已经满了，那么当前线程应该阻塞在这个Condition上直到队列空间可用为止

LinkedBlockingQueue内部是通过两把ReentrantLock锁来分别对**新增、获取**这种操作进行限制的，ReentrantLock底层是基于AQS的同步队列，不理解的可以看我之前写的AQS系列文章。

## 构造器

LinkedBlockingQueue提供了3个构造器

### 无参构造器

```java
public LinkedBlockingQueue() {
    this(Integer.MAX_VALUE);
}
```

无参构造器调用的是另一个带容量参数的构造器，也就是说调用无参构造器返回的是一个容量为Integer.MAX_VALUE的队列，也就相当于一个无界队列。

### 指定队列容量构造器

```java
public LinkedBlockingQueue(int capacity) {
    if (capacity <= 0) throw new IllegalArgumentException();
    this.capacity = capacity;
    last = head = new Node<E>(null);
}
```

一般情况下建议使用这个带容量参数的队列来构造有界阻塞队列，因为如果往队列中新增元素的速度远远超过从队列中获取元素的速度，那么在使用无参构造器的情况下这个阻塞队列很有可能会在段时间内达到Integer.MAX_VALUE大小，就很有可能造成内存溢出。

构造器的最后一行将head和last节点都初始化为同一个item为null的节点，此时head和last节点是没有关联的，它们还没有形成链表结构。形成链表结构是在往队列中新增元素时，即入队的时候。

### 通过集合构造队列

```java
public LinkedBlockingQueue(Collection<? extends E> c) {
    this(Integer.MAX_VALUE);
    final ReentrantLock putLock = this.putLock;
    putLock.lock(); // Never contended, but necessary for visibility
    try {
        int n = 0;
        for (E e : c) {
            if (e == null)
                throw new NullPointerException();
            if (n == capacity)
                throw new IllegalStateException("Queue full");
            enqueue(new Node<E>(e));
            ++n;
        }
        count.set(n);
    } finally {
        putLock.unlock();
    }
}
```

通过这个构造器默认情况下也是创建一个容量为Integer.MAX_VALUE的队列，然后迭代这个集合，默认是不允许往队列中新增null元素的，并且集合的长度也不能超过Integer.MAX_VALUE，接着则是调用enqueue方法将元素入队

#### enqueue

```java
private void enqueue(Node<E> node) {
    last = last.next = node;
}
```

入队方法很简单，不过理解起来可能有一点难度，上面的代码其实是分成两步

```java
last.next = node;
last=node;
```

1. 将尾部节点的next指向新增的节点（元素是从尾部入队的）
2. 再将尾部节点指向新增的节点

**这里有一个隐藏的细节，这个构造器第一步调用了`this(Integer.MAX_VALUE);`这个构造器，现在我们知道通过带容量的构造器会初始化head和last节点为同一个item为null的节点（`last = head = new Node<E>(null);`），所以在执行完`last.next = node;`这行代码后，其实就相当于将head节点的next指向了新增节点，接着执行`last=node;`完这一步就将头部节点、尾部节点和新增节点连接起来了。形成了一个单向链表结构。**

下面我们接着回到上面的构造器中，在所有元素成功入队后，通过AtomicInteger的set方法将当前队列中的元素设置为成功入队的数量，最终在finally块中释放锁，这里有一个疑问，为什么在构造器中需要加上锁呢？作者也加上了解释：**不会产生竞争，而是为了保证可见性。**究其原因是可能存在的指令重排序的原因，导致运行的结果和预期的不一致。

## put方法

```java
public void put(E e) throws InterruptedException {
    if (e == null) throw new NullPointerException();
    int c = -1;
    Node<E> node = new Node<E>(e);
    final ReentrantLock putLock = this.putLock;
    final AtomicInteger count = this.count;
    putLock.lockInterruptibly();
    try {
        // 如果队列满了则阻塞在此
        while (count.get() == capacity) {
            notFull.await();
        }
        // 元素入队
        enqueue(node);
        // 当前元素数量自增加一，注意getAndIncrement方法返回的是自增前的值
        c = count.getAndIncrement();
        // c+1代表此时队列中的数量，如果还没有超过容量则
        // 唤醒上一个因为队列已满而无法往队列新增元素导致阻塞在这个
        // notFull上的线程
        if (c + 1 < capacity)
            notFull.signal();
    } finally {
        // 真正的signal是在这一步发生的
        putLock.unlock();
    }
    // 走到这里如果c==0说明c = count.getAndIncrement();
    // 这行代码执行成功了，也就是现在队列中至少有一个元素了，
    // 那么就通知获取元素的线程开始运行
    if (c == 0)
        signalNotEmpty();
}
```

### signalNotEmpty

```java
private void signalNotEmpty() {
    final ReentrantLock takeLock = this.takeLock;
    takeLock.lock();
    try {
        notEmpty.signal();
    } finally {
        takeLock.unlock();
    }
}
```

当锁被释放之后如果c==0表明此刻队列中至少有一个元素，然后调用signalNotEmpty方法来唤醒上一个因为队列为空而阻塞的获取元素线程。

整个put方法中有一个奇怪的点在于下面这段代码

```java
if (c + 1 < capacity)
    notFull.signal();
```

Condition.await 会释放 putLock，所以同一时刻可以有多个生产者已经进入 put，并在 notFull 条件队列中等待；独占锁只限制同时执行受保护代码的线程数，不限制等待者数量。消费者把队列从满变为未满时先通知一个生产者，醒来的生产者成功插入后若仍有容量，再通知下一个，形成级联通知。

```java
Also, to minimize need for puts to get takeLock and vice-versa, cascading notifies are used.
```

级联通知减少了两把锁之间的交叉获取。消费线程只在计数从 capacity 降到 capacity - 1 时调用 signalNotFull；之后生产者在 putLock 内逐个传递 notFull 信号。take 侧同理：第一次从空变为非空时跨锁通知，消费者在仍有元素时继续通知下一个。

offer、带超时的 offer 和 put 共用相近的入队结构，但等待契约不同：无超时的 offer 无法接纳时立即返回 false，带超时版本最多等待给定时间，put 则等待容量或响应中断。

## take方法

```java
public E take() throws InterruptedException {
    E x;
    int c = -1;
    final AtomicInteger count = this.count;
    final ReentrantLock takeLock = this.takeLock;
    takeLock.lockInterruptibly();
    try {
        while (count.get() == 0) {
            notEmpty.await();
        }
        x = dequeue();
        c = count.getAndDecrement();
        if (c > 1)
            notEmpty.signal();
    } finally {
        takeLock.unlock();
    }
    if (c == capacity)
        signalNotFull();
    return x;
}
```

在理解了put方法的原理之后，take方法的原理也是大同小异，只不过是换了一把take锁而已。整个take方法的执行流程如下：

1. take锁加锁
2. 如果队列是空的则阻塞
3. 调用出队方法dequeue
4. 如果此时队列中至少还有一个元素则调用 `notEmpty.signal();`唤醒其它执行take方法阻塞的线程。注意getAndDecrement方法是先get再递减，返回的是递减前的值
5. 释放 takeLock。signal 已把候选等待者转入锁竞争；它必须重新取得 takeLock 并检查队列状态后才能消费。
6. c 是取出前的计数。只有本次取出完成“满到未满”的转换时才跨锁通知生产者；此前未满时也可能仍有等待者，但通知由 put 侧的级联规则继续传播，不能说它们必然不存在。

take方法的大体流程如上所示，与put方法没有什么太大的区别。我们只需要关注一下元素是如何出队的就可以了

### dequeue

```java
private E dequeue() {
    Node<E> h = head;
    Node<E> first = h.next;
    h.next = h; // help GC
    head = first;
    E x = first.item;
    first.item = null;
    return x;
}
```

出队的流程如下

1. 拿到链表的head节点以及head节点的next节点，这个next节点就是真正持有元素的节点

   ```java
   Node<E> h = head;
   Node<E> first = h.next;
   ```

2. 帮助GC回收无用的对象，然后重新设置head节点

   ```java
   h.next = h; // help GC
   head = first;
   ```

3. 返回队列中的第一个元素，然后清空head节点中的元素

   ```java
   E x = first.item;
   first.item = null;
   ```

这里有一个需要注意的点是head节点在LinkedBlockingQueue中扮演的是一个哨兵的角色，它本身是不持有任何元素的。
所以出队本质上拿的是head节点next节点中的item。

poll、带超时的 poll 和 take 共用相近的出队结构。空队列上，poll 立即返回 null，带超时的 poll 可以等待后返回 null，take 则等待元素或响应中断。

## remove方法

```java
public boolean remove(Object o) {
    if (o == null) return false;
    fullyLock();
    try {
        for (Node<E> trail = head, p = trail.next;
             p != null;
             trail = p, p = p.next) {
            if (o.equals(p.item)) {
                unlink(p, trail);
                return true;
            }
        }
        return false;
    } finally {
        fullyUnlock();
    }
}
```

remove 从队列中删除首个与参数 equals 相等的元素。它需要遍历并修改中间节点链接，删除尾节点时还要更新 last，因此同时持有 putLock 与 takeLock，以免与入队、出队并发改动结构。

### fullyLock

```java
void fullyLock() {
    putLock.lock();
    takeLock.lock();
}
```

执行remove的方法获取到两把锁之后，通过一个while循环从head节点的下一个真正持有元素的节点开始（head节点本身不持有元素，扮演一个哨兵的角色）只要这个节点中的item匹配Object的equals方法，就通过unlink方法将此节点从队列中删除，然后返回true。如果一个都没找到则返回false。重点在于这个unlink方法。

### unlink

```java
void unlink(Node<E> p, Node<E> trail) {
    p.item = null;
    trail.next = p.next;
    if (last == p)
        last = trail;
    if (count.getAndDecrement() == capacity)
        notFull.signal();
}
```

从上面的while循环中我们可以得知方法参数中的p代表的是持有的元素匹配Object，trail代表的是p的前一个节点。整个unlink方法的执行流程如下：

1. 帮助GC回收即将需要删除的节点p

   ```java
   p.item = null;
   ```

2. 将节点从链表中删除，trail是匹配的节点的上一个节点，所以只需要将trail的next执行p的next就将节点删除了

   ```java
   trail.next = p.next;
   ```

3. 校正last节点，如果last节点是与Object匹配的节点，需要将last执行p的前驱节点

   ```java
   if (last == p)
       last = trail;
   ```

4. 判断是否需要同时阻塞的put线程，因为unlink最终会使队列中的元素数量减一，所以如果之前有put线程被阻塞的话就尝试去唤醒，至于为什么是和capacity作比较，原因我已经在上面的take方法中做过解释了。

   ```java
   if (count.getAndDecrement() == capacity)
       notFull.signal();
   ```

## drainTo方法

LinkedBlockingQueue中的两个drainTo方法最终调用的后一个drainTo方法，即带最大转移数量参数的drainTo方法

```java
public int drainTo(Collection<? super E> c, int maxElements) {
    if (c == null)
        throw new NullPointerException();
    if (c == this)
        throw new IllegalArgumentException();
    if (maxElements <= 0)
        return 0;
    boolean signalNotFull = false;
    final ReentrantLock takeLock = this.takeLock;
    takeLock.lock();
    try {
        int n = Math.min(maxElements, count.get());
        // count.get provides visibility to first n Nodes
        Node<E> h = head;
        int i = 0;
        try {
            while (i < n) {
                Node<E> p = h.next;
                c.add(p.item);
                p.item = null;
                h.next = h;
                h = p;
                ++i;
            }
            return n;
        } finally {
            // Restore invariants even if c.add() threw
            if (i > 0) {
                // assert h.item == null;
                head = h;
                signalNotFull = (count.getAndAdd(-i) == capacity);
            }
        }
    } finally {
        takeLock.unlock();
        if (signalNotFull)
            signalNotFull();
    }
}
```

1. 目标集合不能为 null 或队列本身；maxElements 小于或等于零时直接返回零，不抛出参数异常。
2. 计算出maxElements与当前队列中元素数量这两者间较小的值作为即将转移的元素数量
3. take锁加锁
4. 逐个向目标集合 add 元素，i 只统计成功转移的数量；即使 add 抛出异常，finally 也按已转移的元素更新 head 和计数。计数从满变为未满时跨锁通知生产者，之后由 put 侧继续级联通知。此操作不为目标集合提供额外的事务或线程安全保证。

## 例子

下面是一个使用LinkedBlockingQueue的简单例子

```java
package io.allurx;

import java.time.LocalDateTime;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * @author allurx
 */
public class Test {

    public static void main(String[] args) {
        BlockingQueue<Integer> blockingQueue = new LinkedBlockingQueue<>();
        Producer producer = new Producer(blockingQueue);
        Consumer consumer1 = new Consumer(blockingQueue, "consumer1");
        Consumer consumer2 = new Consumer(blockingQueue, "consumer2");
        Consumer consumer3 = new Consumer(blockingQueue, "consumer3");
        producer.start();
        consumer1.start();
        consumer2.start();
        consumer3.start();
    }

    static class Producer extends Thread {

        private BlockingQueue<Integer> blockingQueue;

        public Producer(BlockingQueue<Integer> blockingQueue) {
            this.blockingQueue = blockingQueue;
        }

        public void produce() {
            LocalDateTime end = LocalDateTime.now().plusSeconds(2);
            while (LocalDateTime.now().isBefore(end)) {
                try {
                    blockingQueue.put(1);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }

        @Override
        public void run() {
            produce();
        }
    }

    static class Consumer extends Thread {
        private BlockingQueue<Integer> blockingQueue;

        public Consumer(BlockingQueue<Integer> blockingQueue, String name) {
            super(name);
            this.blockingQueue = blockingQueue;
        }

        public void consume() {
            while (true) {
                try {
                    System.out.println(Thread.currentThread().getName() + "：" + blockingQueue.take());
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }

        @Override
        public void run() {
            consume();
        }
    }
}
```

控制台输出

```java
consumer1：1
consumer1：1
consumer2：1
consumer2：1
consumer2：1
consumer3：1
consumer3：1
consumer3：1
..........
```

1. Producer线程往队列put元素两秒之后停止
2. 开启三个Consumer线程去消费队列中的元素直到队列中的元素为空为止，然后三个消费者被阻塞

## 总结

LinkedBlockingQueue是一个基于单向链表并且可设置容量的阻塞队列。LinkedBlockingQueue中的元素都是按照FIFO即先进先出的元素排列的，在队列头部的元素是在队列中停留时间最长的元素，相反在队列尾部的元素是则是在队列中停留时间最短的元素。元素是从队列尾部新增进入队列的，而获取元素是从队列头部开始获取的。但是head节点本身是不持有元素的，他仅仅扮演了一个哨兵的角色。LinkedBlockingQueue中有两把ReentrantLock分别对应put和take这两个语义，这两种操作单独执行都是独占相应锁的，但是put和take方法相互间是可以并行执行的，即A线程执行put操作与B线程执行take操作是可以同时执行的。

## 资料来源

- [LinkedBlockingQueue：容量与并发契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html)
