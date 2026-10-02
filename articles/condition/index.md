---
title: Condition
date: 2019-09-16
updated: 2026-10-02
tags:
  - Java
  - Concurrent
  - Lock
  - Condition
domain: Java
---

`Condition` 把等待队列与锁的获取队列分开。调用 `await()` 时释放关联锁，结束等待后重新获取锁；`signal()` 只让等待者进入竞争，不把锁直接交给它。等待者必须在循环中重新检查条件，才能处理虚假唤醒、中断、超时和其他线程的竞争。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java) 的 AQS ConditionObject 为例，分析等待节点在条件队列与同步队列间的转移。ReentrantLock 的通知顺序是该实现的契约；定时等待返回前仍需重新获得锁，不能把超时直接理解为方法已经返回。


## Condition

Condition接口中定义了线程等待和通知的方法定义，基本上和Object类中的wait/notify一致。

```java
public interface Condition {

    void await() throws InterruptedException;

    void awaitUninterruptibly();

    long awaitNanos(long nanosTimeout) throws InterruptedException;

    boolean await(long time, TimeUnit unit) throws InterruptedException;

    boolean awaitUntil(Date deadline) throws InterruptedException;

    void signal();

    void signalAll();
}
```

对于本文的 ReentrantLock.ConditionObject，调用 await、signal 和 signalAll 时必须持有对应的锁，否则抛出 IllegalMonitorStateException。创建 Condition 对象本身不要求已经加锁。

## Lock

```java
public interface Lock {

    void lock();

    void lockInterruptibly() throws InterruptedException;

    boolean tryLock();

    boolean tryLock(long time, TimeUnit unit) throws InterruptedException;

    void unlock();
    // 借助于锁，可以new一个Condition对象
    Condition newCondition();
}
```

Lock.newCondition 用于创建与这把锁关联的条件对象。ReentrantLock 通过 AQS.ConditionObject 实现它，同一把锁可以拥有多个独立的条件队列。条件等待与重新获取锁使用不同队列，下面分别分析。

## 例子

在分析ConditionObject前我们先借助于Condition类注释上的一个例子来感受一下应当如何使用Condition，以便接下来我们能够更好的分析其原理。

```java
package io.allurx;

import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

/**
 * @author allurx
 */
public class BoundedBuffer {
    /**
     * 锁实例
     */
    private final Lock lock = new ReentrantLock();

    /**
     * 数组中的元素已满条件
     */
    private final Condition notFull = lock.newCondition();

    /**
     * 数组中的元素为空条件
     */
    private final Condition notEmpty = lock.newCondition();

    /**
     * 存放元素的数组
     */
    private final Object[] items = new Object[100];

    /**
     * 即将存放的元素在数组中的位置
     */
    private int putIndex = 0;

    /**
     * 即将获取的元素在数组中的位置
     */
    private int takeIndex = 0;

    /**
     * 当前数组中的数量
     */
    private int count = 0;

    /**
     * 往数组中存放元素
     *
     * @param x 元素
     * @throws InterruptedException 线程中断异常
     */
    public void put(Object x) throws InterruptedException {
        // 必须先获取锁
        lock.lock();
        try {
            // 如果数组中的元素已经满了，那么调用该方法的线程需要等待直到
            // 其它从数组中取元素的线程成功取出之后通知其能够继续存放元素
            while (count == items.length) {
                notFull.await();
            }
            // 将元素存放到指定位置
            items[putIndex] = x;
            // 如果下一个位置超过数组长度了，就置0，相当于从头开始覆盖之前的槽位的元素
            if (++putIndex == items.length) {
                putIndex = 0;
            }
            // 当前数组中的元素数量加一
            ++count;
            // 成功存放之后，就可以通知取元素的线程运行了
            notEmpty.signal();
        } finally {
            // 最终释放锁
            lock.unlock();
        }
    }

    /**
     * 从数组中取元素
     *
     * @return 元素
     * @throws InterruptedException 线程中断异常
     */
    public Object take() throws InterruptedException {
        // 必须先获取锁
        lock.lock();
        try {
            // 如果当前数组中没有元素的话，那么调用该方法的线程需要等待直到
            // 存放元素的线程成功存放之后通知其能够继续去元素
            while (count == 0) {
                notEmpty.await();
            }
            // 从指定位置取出元素
            Object x = items[takeIndex];
            // 如果下一个位置超过数组长度了，就置0，相当于从头开始重新取元素
            if (++takeIndex == items.length) {
                takeIndex = 0;
            }
            // 当前数组中的元素数量减一
            --count;
            // 成功取出元素之后，就可以通知存放元素的线程运行了
            notFull.signal();
            return x;
        } finally {
            // 最终释放锁
            lock.unlock();
        }
    }
}
```

例子使用同一把 ReentrantLock 保护数组与计数，并创建 notFull 和 notEmpty 两个条件队列。生产者在数组满时等待，消费者在数组空时等待；await 释放锁，signal 使一个等待者转入锁竞争。等待者重新获取锁后仍在 while 中检查条件。

## ConditionObject

在开始分析ConditionObject原理之前我们先来回顾一下AQS，其内部定义了一个CLH队列（变种）是一个**双向链表**，通过Node类的prev和next变量指向前后节点，而等待ConditionObject的线程则是被添加到了一个**单向链表**中，通过Node类的nextWaiter表里指向后一个等待节点的。注意构成这两种队列的对象都是AQS中的静态Node内部类。

```java
// 条件队列中的第一个节点
private transient Node firstWaiter;
// 条件队列中的最后一个节点
private transient Node lastWaiter;
```

当多个线程等待在同一个Condition上时最终会形成如下图所示的条件队列

![](./images/condition-wait-queue.png)

下面我们开始分析线程是如何入队和出队的。

### await()

await方法就是入队的体现。

```java
public final void await() throws InterruptedException {
    // await方法不会忽略线程的中断
    if (Thread.interrupted())
        throw new InterruptedException();
    // 将当前线程构造成Node添加到条件队列中
    Node node = addConditionWaiter();
    // 将当前线程入队后，就可以释放自己拥有的锁了，这里调用的AQS的fullyRelease方法，
    // 如果当前线程不是拥有锁的线程会抛出IllegalMonitorStateException，并且之前构造的
    // 节点状态也会变为CANCELLED，注意fullyRelease释放锁后，下面的代码就会开始存在并发了
    int savedState = fullyRelease(node);
    int interruptMode = 0;
    // 这个while循环判断很重要，isOnSyncQueue判断的是该节点当前是否处于
    // clh队列中，你可能会很好奇构造的节点不是在条件队列中吗，怎么会进入到clh队列中呢？
    // 其实首次await肯定是在条件队列中的，然后就会被LockSupport阻塞，
    // 接着在其它线程调用signal或者signalAll方法后如果成功，线程就会进入到clh队列，
    // 并且这两个通知方法的调用必定是更随着lock.unlock同时执行的，也就是说如果能够成功被唤醒
    // 就会接着从下面的LockSupport.park(this)方法下一行处继续执行。
    while (!isOnSyncQueue(node)) {
        // 第一次await后会在此处阻塞
        LockSupport.park(this);
        // 被唤醒后会继续从这一个if判断开始执行，判断阻塞期间是否中断过，
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
    }
    if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
        interruptMode = REINTERRUPT;
    if (node.nextWaiter != null) // clean up if cancelled
        unlinkCancelledWaiters();
    if (interruptMode != 0)
        reportInterruptAfterWait(interruptMode);
}
```

首先第一步调用addConditionWaiter方法构造Node并添加到条件队列中。

#### addConditionWaiter()

```java
private Node addConditionWaiter() {
    // 当前条件队列中的最后一个节点
    Node t = lastWaiter;
    // 如果最后一个节点的状态不是CONDITION（已取消）就将其从队列中移除
    if (t != null && t.waitStatus != Node.CONDITION) {
        unlinkCancelledWaiters();
        t = lastWaiter;
    }
    // 将当前线程构造成Node，并且状态为CONDITION
    Node node = new Node(Thread.currentThread(), Node.CONDITION);
    // 如果最后一个节点为null说明此刻是第一次创建队列或者是经历过上面的unlinkCancelledWaiters方法
    // 剔除之后队列中没有节点了
    if (t == null)
        firstWaiter = node;
    // 如果最后一个节点不为null说明队列中至少有两个节点，此时只需要将之前的最后一个
    // 节点的nextWaiter指向新构造的节点，组成新的队列
    else
        t.nextWaiter = node;
    // 最后将lastWaiter指向最新构造的节点
    lastWaiter = node;
    return node;
}
```

addConditionWaiter方法的作用是将线程构造成Node入队，在入队前会判断最后一个节点是否处于已取消状态，如果已取消的话就会调用unlinkCancelledWaiters方法将这些无用的节点剔除掉。

##### unlinkCancelledWaiters()

```java
private void unlinkCancelledWaiters() {
    Node t = firstWaiter;
    // 记录上一个不是取消状态的节点
    Node trail = null;
    // 从头开始往后遍历直到队列尾部，因为最后一个节点的next属性为null
    while (t != null) {
        // 下一个节点
        Node next = t.nextWaiter;
        // 如果当前循环的节点是取消状态
        if (t.waitStatus != Node.CONDITION) {
            // 这一步是帮助gc回收
            t.nextWaiter = null;
            // 只要没有找到一个未取消的节点，也就是说执行到这一步之前的节点都是
            // 已取消的，那么头部节点至少应该是当前循环节点的下一个节点。因为当前节点
            // 是取消状态。
            if (trail == null)
                firstWaiter = next;
            // 已经找到上一个不是取消状态的节点，那么将当前循环的节点剔除掉，将
            // 上一个不是取消状态的节点的nextWaiter指向当前循环节点的下一个节点
            else
                trail.nextWaiter = next;
            // 如果当前节点的下一个节点为null，也就是说当前节点就是lastWaiter，但是它是已取消状态，
            // 那就将上一个正常状态的节点trail赋值给lastWaiter
            if (next == null)
                lastWaiter = trail;
        }
        // 如果当前循环的节点不是取消状态，记录下来，将值赋值给trail，
        // 也就是说下一次循环拿到的trail是上一个不是取消状态的节点
        else
            trail = t;
        // 将下一次是否循环的值t指向前一个节点的next（下一个节点）
        t = next;
    }
}
```

unlinkCancelledWaiters方法的作用是从头部节点开始一直遍历到最后一个节点，将其中已取消的节点从队列中剔除掉。下面我们继续回到await方法中来，当前线程成功入队后就会释放自己拥有的锁，这里调用的是AQS的fullyRelease方法

#### fullyRelease(Node node)

```java
final int fullyRelease(Node node) {
    boolean failed = true;
    try {
        int savedState = getState();
        if (release(savedState)) {
            failed = false;
            return savedState;
        } else {
            throw new IllegalMonitorStateException();
        }
    } finally {
        if (failed)
            node.waitStatus = Node.CANCELLED;
    }
}
```

这是独占模式下释放锁的方法，也就是说如果当前线程不是拥有锁的线程就会抛出IllegalMonitorStateException，然后进入到finally语句块中，之前构造的Node状态就会变更为CANCELLED。这也就是为什么在入队的时候会先去判断一下尾部节点（上一个入队的节点）是否处于取消状态，是为了保证队列中的节点都是处于CONDITION状态的节点。当前线程释放锁后，接下来就可以阻塞了，阻塞方法是处于一个while判断中，每次阻塞前都调用isOnSyncQueue方法判断其是否处于clh队列中，为什么要做这个判断呢？因为阻塞在ConditionObject上的线程的唤醒操作依旧是基于AQS来实现的，也就是说当前线程所在的节点会从条件队列中转换到clh队列中。下面我们来看一下是怎么判断线程是否处于clh队列中的。

#### isOnSyncQueue(Node node)

```java
final boolean isOnSyncQueue(Node node) {
    // 1.节点状态为CONDITION说明肯定不在clh队列中，因为只要转换成功节点状态就会被设置为0
    // 2.这里需要回顾一下AQS的enq入队方法，将节点添加到尾部时才会指定prev，
    // 也就是说prev为null那么节点至少此刻在执行这个判断的时候是不在clh队列中的
    if (node.waitStatus == Node.CONDITION || node.prev == null)
        return false;
    // 这一点同样需要回顾AQS的enq入队方法，将新节点添加到尾部时才会指定前一个节点的next，也就是说
    // 节点存在next那么该节点肯定已经在clh队列中了
    if (node.next != null)
        return true;
	// 这一种情况比较复杂，会在下面着重分析
    return findNodeFromTail(node);
}

// 从clh队列尾部往前遍历，只要找到这个节点，说明已经进入clh队列了。
private boolean findNodeFromTail(Node node) {
    Node t = tail;
    for (;;) {
        if (t == node)
            return true;
        if (t == null)
            return false;
        t = t.prev;
    }
}
```

isOnSyncQueue前面两个if判断属于常规情况下的瞬时判断，判断的那一刻满足特定的条件就能知道那一刻的节点是否处于clh队列中。如果此刻节点同时不满足以上两个if条件，此刻节点我们可以推断出它的一些属性状态。

1. 节点的状态不是CONDITION
2. 节点的prev不为null
3. 节点的next为null

节点已设置 prev 但尚未连接到尾部时，不能只凭局部字段确认入队。signal 需要持锁，并不意味着同步队列没有并发入队：其他竞争锁的线程，以及因中断或超时离开条件队列的线程，都可能执行 enq。CAS 设置 tail 可能失败；findNodeFromTail 沿已发布的 prev 链确认节点是否真正进入同步队列。

```java
private Node enq(final Node node) {
    for (;;) {
        Node t = tail;
        if (t == null) { // Must initialize
            if (compareAndSetHead(new Node()))
                tail = head;
        } else {
            // 只要是入队prev肯定是有值的，指向前一个tail
            node.prev = t;
            if (compareAndSetTail(t, node)) {
                // 最后一个入队的节点是没有next的
                t.next = node;
                return t;
            }
        }
    }
}
```

继续回到await方法，如果当前节点不在clh队列中，就调用LockSupport.park(this)使当前调用await方法的线程阻塞在该ConditionObject对象上，**等待其它线程调用signal或者signalAll唤醒或者是被其它线程中断**。这里需要明确的一点是当前线程已经被阻塞在下面这行代码处了

```java
while (!isOnSyncQueue(node)) {
    // 阻塞在这一行
    LockSupport.park(this);
    // 从这一行开始执行要么是其它线程调用了signal或者signalAll方法，
    // 或者是该线程被中断了
    if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
        break;
}
```

从上面代码我们可以得知，要跳出while循环有两种情况

1. 节点已经传输到clh队列中了
2. 节点线程在阻塞期间被中断了

下面我们来分析一下checkInterruptWhileWaiting方法

#### checkInterruptWhileWaiting(Node node)

```java
private int checkInterruptWhileWaiting(Node node) {
    return Thread.interrupted() ?
        (transferAfterCancelledWait(node) ? THROW_IE : REINTERRUPT) :
    0;
}
```

注意如果线程的确被中断了，那么Thread.interrupted()方法会改变其中断标记值。进一步调用transferAfterCancelledWait方法判断是什么时候中断的，否则的话返回0代表阻塞期间没有发生中断。

#### transferAfterCancelledWait(Node node)

```java
final boolean transferAfterCancelledWait(Node node) {
    if (compareAndSetWaitStatus(node, Node.CONDITION, 0)) {
        enq(node);
        return true;
    }
    /*
     * If we lost out to a signal(), then we can't proceed
     * until it finishes its enq().  Cancelling during an
     * incomplete transfer is both rare and transient, so just
     * spin.
     */
    while (!isOnSyncQueue(node))
        Thread.yield();
    return false;
}
```

`transferAfterCancelledWait` 的返回值取决于谁先成功把节点的 CONDITION 状态改为零。返回 true 表示取消等待的一方完成转换并负责入队；false 表示通知方先完成转换，此时需等它完成入队。这是对节点状态的竞争，不等同于两个方法调用开始的先后顺序。

1. 返回 0，表示本次没有检测到中断；park 也可能虚假返回，不能据此判断已经得到通知。
2. 返回 THROW_IE，表示中断取消先完成节点状态转换，重新获得锁后抛出 InterruptedException。
3. 返回 REINTERRUPT，表示通知方先完成状态转换，重新获得锁并返回前恢复中断标记。

并且从transferAfterCancelledWait方法中我们可以得知，如果线程是因为中断才得以运行的，那么其最终也能转移到clh队列中。继续回到await方法中来

```java
// 现在已经跳出while循环了，注意走到这一步有两种情况：
// 1.其它线程调用signal或者signalAll方法唤醒的
// 2.线程在阻塞期间被中断了，不理解的可以看checkInterruptWhileWaiting方法
// 并且此刻当前线程所在的节点肯定已经转移到clh队列了。只需要去尝试获取锁，成功则继续运行，否则继续阻塞。
if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
    interruptMode = REINTERRUPT;
// 取消等待的节点可能还留在条件链表上，清理这些失效链接。
if (node.nextWaiter != null) // clean up if cancelled
    unlinkCancelledWaiters();
// 还原或者是抛出中断异常
if (interruptMode != 0)
    reportInterruptAfterWait(interruptMode);
```

转入同步队列后，acquireQueued 使用 savedState 重新获取等待前的完整持锁状态。若条件等待阶段已经确定 THROW_IE，则在重新持锁后抛出异常；否则，重新获取期间检测到的中断会记为 REINTERRUPT，在返回前恢复中断标记。

#### reportInterruptAfterWait(int interruptMode)

```java
private void reportInterruptAfterWait(int interruptMode)
    throws InterruptedException {
    // 中断取消先赢得节点状态转换时，在重新持锁后抛出中断异常。
    if (interruptMode == THROW_IE)
        throw new InterruptedException();
    // 如果是唤醒之后才中断的则还原中断标记，对应wait/notify机制
    else if (interruptMode == REINTERRUPT)
        selfInterrupt();
}
```

`reportInterruptAfterWait` 按已经确定的模式抛出 InterruptedException 或恢复中断标记。判断依据是取消与通知对节点状态的竞争，以及重新获取期间的中断；不能简化成“阻塞时中断就抛出，运行时中断就不抛出”。

### await总结

下面对await方法做一个总结

1. 调用该方法的线程如果处于中断状态，则会立马抛出InterruptedException，这和wait/notify保持一致
2. await方法调用必须保证当前线程拥有该Condition的锁，否则会抛出IllegalMonitorStateException，详情见fullyRelease方法
3. 先将节点加入条件队列，再完整释放锁。通知、中断取消或定时方法中的超时可以把节点转入同步队列；只有重新获取锁后，等待操作才会正常返回或报告等待期间的中断。

### signal()

signal方法相当于Object中的notify方法，用来唤醒等待在条件队列中的第一个节点线程

```java
public final void signal() {
    // 同样是拥有锁的线程才能执行
    if (!isHeldExclusively())
        throw new IllegalMonitorStateException();
    Node first = firstWaiter;
    if (first != null)
        // 唤醒第一个节点线程
        doSignal(first);
}
```

#### doSignal(Node first)

```java
private void doSignal(Node first) {
    do {
        // 将条件队列中第一个节点重新设置为前一个节点的下一个节点，同样作用于下面的while判断。
        // 同时判断是否为null，为null说明已经是最后一个节点了。
        if ( (firstWaiter = first.nextWaiter) == null)
            // 帮助gc回收
            lastWaiter = null;
        // 帮助gc回收
        first.nextWaiter = null;
        // 将节点转移到clh队列中
    } while (!transferForSignal(first) &&
             // 下一个firstWaiter不为null，此刻的firstWaiter已经在while循环
             // 一开始被设置为first的nextWaiter了
             (first = firstWaiter) != null);
}
```

`doSignal` 从条件队列头部移除候选节点。只有该节点已取消、无法转移时才继续检查下一个；找到能够转入同步队列的节点后停止。转移逻辑由 transferForSignal 完成。

#### transferForSignal(Node node)

返回是否能够将条件队列中的第一个节点转移到clh队列中

```java
final boolean transferForSignal(Node node) {
    /*
     * If cannot change waitStatus, the node has been cancelled.
     */
    if (!compareAndSetWaitStatus(node, Node.CONDITION, 0))
        return false;

    /*
     * Splice onto queue and try to set waitStatus of predecessor to
     * indicate that thread is (probably) waiting. If cancelled or
     * attempt to set waitStatus fails, wake up to resync (in which
     * case the waitStatus can be transiently and harmlessly wrong).
     */
    Node p = enq(node);
    int ws = p.waitStatus;
    if (ws > 0 || !compareAndSetWaitStatus(p, ws, Node.SIGNAL))
        LockSupport.unpark(node.thread);
    return true;
}
```

下面对signal方法做一个总结：

1. 调用signal方法方法的线程必须拥有当前Condition所在的锁，否则会抛出IllegalMonitorStateException，这和wait/notify机制保持一致
2. signal方法会将条件队列中的第一个节点（等待时间最长的节点）转移到clh队列中，如果转移失败就往后直到找到一个不为null且没有取消的节点。signal 本身不释放锁。通知者随后释放锁时，同步队列中的等待者才有机会竞争；被转移的节点不一定立即成为队头的后继，等待者必须重新取得锁才能从 await 返回。
3. signal方法和Object.notify方法在唤醒机制上有一点不同，**ReentrantLock 的 Condition 按 FIFO 选择条件队列中的等待者；重新获取锁的顺序仍受锁的获取规则影响。Object.notify 不保证选择顺序**。

### signalAll()

在理解signal方法后，再去理解signalAll方法就很容易了

```java
public final void signalAll() {
    if (!isHeldExclusively())
        throw new IllegalMonitorStateException();
    Node first = firstWaiter;
    if (first != null)
        doSignalAll(first);
}
```

signalAll方法是同时将条件队列中的节点全部转移到clh队列中

#### doSignalAll(Node first)

```java
private void doSignalAll(Node first) {
    // 帮助gc回收
    lastWaiter = firstWaiter = null;
    do {
        Node next = first.nextWaiter;
        // 帮助gc回收
        first.nextWaiter = null;
        transferForSignal(first);
        // 便于下一次循环
        first = next;
    } while (first != null);
}
```

从条件队列中的第一个节点开始依次调用transferForSignal方法将其转移到clh队列中。

### awaitUninterruptibly()

```java
public final void awaitUninterruptibly() {
    Node node = addConditionWaiter();
    int savedState = fullyRelease(node);
    boolean interrupted = false;
    while (!isOnSyncQueue(node)) {
        LockSupport.park(this);
        // 阻塞期间中断过，Thread.interrupted()会改变中断标记，所以需要重置
        if (Thread.interrupted())
            interrupted = true;
    }
    // 排队期间中断过或者在被唤醒前中断过，则重置中断标记
    if (acquireQueued(node, savedState) || interrupted)
        selfInterrupt();
}
```

awaitUninterruptibly和await方法的唯一不同之处在于**awaitUninterruptibly方法对中断不敏感**，它会忽略调用线程的中断标记以及在阻塞期间的中断，awaitUninterruptibly结束后如果期间发生过中断，会将中断标记恢复。

### awaitNanos(long nanosTimeout)

awaitNanos方法的作用是提供定时等待的作用。等待指定时间过后，线程会被自动唤醒。

```java
public final long awaitNanos(long nanosTimeout)
        throws InterruptedException {
    if (Thread.interrupted())
        throw new InterruptedException();
    Node node = addConditionWaiter();
    int savedState = fullyRelease(node);
    final long deadline = System.nanoTime() + nanosTimeout;
    int interruptMode = 0;
    while (!isOnSyncQueue(node)) {
        if (nanosTimeout <= 0L) {
            transferAfterCancelledWait(node);
            break;
        }
        if (nanosTimeout >= spinForTimeoutThreshold)
            LockSupport.parkNanos(this, nanosTimeout);
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
        nanosTimeout = deadline - System.nanoTime();
    }
    if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
        interruptMode = REINTERRUPT;
    if (node.nextWaiter != null)
        unlinkCancelledWaiters();
    if (interruptMode != 0)
        reportInterruptAfterWait(interruptMode);
    return deadline - System.nanoTime();
}
```

awaitNanos方法提供了类似Object的`wait(long timeout)`方法的定时等待功能。返回值是剩余可等待纳秒数的估计值，不是已经花费的时间。返回值小于或等于零表示没有剩余时间；返回后仍需检查业务条件。

### awaitUntil(Date deadline)

awaitUntil提供了定时等待的功能，等待到指定时间后，线程会被自动唤醒。

```java
public final boolean awaitUntil(Date deadline)
        throws InterruptedException {
    long abstime = deadline.getTime();
    if (Thread.interrupted())
        throw new InterruptedException();
    Node node = addConditionWaiter();
    int savedState = fullyRelease(node);
    boolean timedout = false;
    int interruptMode = 0;
    while (!isOnSyncQueue(node)) {
        if (System.currentTimeMillis() > abstime) {
            timedout = transferAfterCancelledWait(node);
            break;
        }
        LockSupport.parkUntil(this, abstime);
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
    }
    if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
        interruptMode = REINTERRUPT;
    if (node.nextWaiter != null)
        unlinkCancelledWaiters();
    if (interruptMode != 0)
        reportInterruptAfterWait(interruptMode);
    return !timedout;
}
```

达到截止时间只意味着可以结束条件等待，方法还必须经过 acquireQueued 重新获得锁才能返回。超时与 signal 可能竞争同一节点的转换，返回值报告哪种等待结果获胜，业务条件仍需由调用者检查。

* **方法返回true，表示等待未超时；仍需要重新检查业务条件。中断按方法契约抛出 InterruptedException，不能解释为返回 true**
* **方法返回 false 表示超时取消赢得了节点转移；不能据此断言其他线程从未调用过 signal。**

### await(long time, TimeUnit unit)

```java
public final boolean await(long time, TimeUnit unit)
        throws InterruptedException {
    long nanosTimeout = unit.toNanos(time);
    if (Thread.interrupted())
        throw new InterruptedException();
    Node node = addConditionWaiter();
    int savedState = fullyRelease(node);
    final long deadline = System.nanoTime() + nanosTimeout;
    boolean timedout = false;
    int interruptMode = 0;
    while (!isOnSyncQueue(node)) {
        if (nanosTimeout <= 0L) {
            timedout = transferAfterCancelledWait(node);
            break;
        }
        if (nanosTimeout >= spinForTimeoutThreshold)
            LockSupport.parkNanos(this, nanosTimeout);
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
        nanosTimeout = deadline - System.nanoTime();
    }
    if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
        interruptMode = REINTERRUPT;
    if (node.nextWaiter != null)
        unlinkCancelledWaiters();
    if (interruptMode != 0)
        reportInterruptAfterWait(interruptMode);
    return !timedout;
}
```

该方法同样提供了定时等待的作用。等待指定时间过后，线程会被自动唤醒。同时结合`awaitNanos(long nanosTimeout)`和`awaitUntil(Date deadline)`两个方法的分析，**该方法返回 true 表示等待未超时，false 表示等待已超时。中断按契约抛出 InterruptedException；即使返回 true，业务条件也可能还未成立，需要循环检查。**

## 总结

Condition 将业务条件等待与锁关联起来，同一把锁可以拥有多个条件队列。本文的 ReentrantLock 实现按条件队列顺序选择通知对象，但重新获取锁仍遵守锁本身的规则；调用者始终需要用循环检查业务条件。

## 资料来源

- [Condition：等待、通知与超时返回值](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Condition.html)
- [ReentrantLock.newCondition：通知与锁获取顺序](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html#newCondition())
