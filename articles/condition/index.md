---
title: Condition
date: 2019-09-16
updated: 2026-10-01
tags:
  - Java
  - Concurrent
  - Lock
  - Condition
domain: Java
---

## 核心结论

`Condition` 把等待队列与锁的获取队列分开。调用 `await()` 时释放关联锁，结束等待后重新获取锁；`signal()` 只让等待者进入竞争，不把锁直接交给它。等待者必须在循环中重新检查条件，才能处理虚假唤醒、中断、超时和其他线程的竞争。

## 问题与适用范围

本文回答原文 AQS `ConditionObject` 如何迁移等待节点，保留未标注精确 JDK 修订的旧源码。`ReentrantLock` 的条件通知规则不能当作所有 `Condition` 实现的统一保证。定时方法的返回值需要按各自契约解释，等待超时也不等于已经重新取得锁并返回。

<!-- more -->

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

在文章开头处我们知道在使用Condition前必须得获取一个java.util.concurrent.locks.Lock才能调用Condition相关的方法，否则会抛出IllegalMonitorStateException，下面我们来看一下这个Lock

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

我们发现其中有一个newCondition方法定义，现在我们思考一下既然有锁，那我们获取锁之后是不是就能基于这个锁new一个Condition出来了呢？再联系wait/notify机制，现在是不是可以更好的理解Condition与锁之间的关系了呢。查看实现Lock接口的类发现了ReentrantLock等一些常用的锁，我们继续查看实现Condition接口的类，发现其是定义在AQS中的一个内部类ConditionObject，联系AQS中节点waitStatus，状态值可能为CONDITION，以及内部的CLH队列，一切似乎都和AQS关联起来了，下面我们就从ConditionObject开始逐步分析其原理。

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

上面的例子中，类比生产者和消费者模式往数组中存放和取出元素，通过在ReentrantLock上构造两个Condition分别表示当前数组已满条件和当前数组为空条件，存放和获取元素的线程只有满足以上条件才能运行，否则将会调用await方法，线程将会进入到条件队列中等待，直到在对应的Condition上调用signal方法通知等待线程开始运行。

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

现在我们知道节点有以上三种属性，在最后一个判断的注释上面，作者解释条件队列的节点转在移到clh队列时可能会存在cas失败，这里就要涉及到是什么时候转移的了，回想wait/notify机制，转换其实是发生在signal或者是signalAll的时候（这两个方法都是通过AQS的enq方法将节点入队的）所以我不是特别明白什么情况下cas会失败，因为无论signal还是signalAll方法的调用都是保证当前拥有锁的线程才能调用，也就是说执行通知时操作条件队列转移到clh队列的只会有一个线程，将条件队列中的节点转移到clh队列中不会存在并发的情况，那cas失败指的是什么意思呢？什么情况下节点才会拥有以上三个属性然后进入到findNodeFromTail方法中判断呢？经过我的测试只有在clh队列中的最后一个节点才会进入以上判断。首先已经进入clh队列了说明状态已经变成0了，并且通过enq方法设置prev值为前一个tail了，但是注意因为是队列中的最后一个节点，所以next是为null的，所以就会出现这种情况然后进入到findNodeFromTail方法中再次找一下是不是在clh队列中，看一下enq方法

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
    // 此刻是有可能存在其它线程调用signal或者signalAll方法的，如果cas成功，说明此刻还没有调用
    // 通知方法，因为调用过signal或者signalAll方法节点的状态值肯定会被修改成0，也就表明当前线程中断是发生在调
    // 用过signal或者signalAll方法之前的
    if (compareAndSetWaitStatus(node, Node.CONDITION, 0)) {
        // 即使中断了依旧将其转移到clh队列中
        enq(node);
        return true;
    }
    // 走到这里说明上一步的cas失败了，也就是有线程正在调用signal或者signalAll方法转移节点到clh队列，
    // 但是可能还没有转移好，那就调用yield方法稍微让一步，等其它线程将节点转移到clh队列后再退出，为
    // 跳出整个while循环后的acquireQueued方法作准备
    while (!isOnSyncQueue(node))
        Thread.yield();
    return false;
}
```

transferAfterCancelledWait返回true说明线程发生中断是在调用signal或者signalAll方法之前，返回false则是调用之后。然后再回到checkInterruptWhileWaiting这个方法，我们对其返回值做一个总结

1. 返回0，说明线程是被调用signal或者signalAll方法正常唤醒的
2. 返回THROW_IE，说明线程是被中断才得以运行的，并且中断是发生在调用signal或者signalAll方法之前
3. 返回REINTERRUPT，说明线程是被中断才得以运行的，并且中断是发生在调用signal或者signalAll方法之后

并且从transferAfterCancelledWait方法中我们可以得知，如果线程是因为中断才得以运行的，那么其最终也能转移到clh队列中。继续回到await方法中来

```java
// 现在已经跳出while循环了，注意走到这一步有两种情况：
// 1.其它线程调用signal或者signalAll方法唤醒的
// 2.线程在阻塞期间被中断了，不理解的可以看checkInterruptWhileWaiting方法
// 并且此刻当前线程所在的节点肯定已经转移到clh队列了。只需要去尝试获取锁，成功则继续运行，否则继续阻塞。
if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
    interruptMode = REINTERRUPT;
// 这里不明白为什么要清除取消的节点
if (node.nextWaiter != null) // clean up if cancelled
    unlinkCancelledWaiters();
// 还原或者是抛出中断异常
if (interruptMode != 0)
    reportInterruptAfterWait(interruptMode);
```

在第一个if判断中调用AQS的acquireQueued方法使当前线程重新尝试获取锁，如果获取失败依旧会被阻塞，注意这个方法的返回值，true代表整个acquireQueued期间被中断过，false代表没有中断过。整个`acquireQueued(node, savedState) && interruptMode != THROW_IE`所表达的意思就是**线程被唤醒后尝试去获取锁只要在获取锁的期间被中断过并且这个线程在跳出之前的while循环时不是因为在调用signal或者signalAll方法之前被中断的，就将中断模型设置为重新设置中断标记，这和wait/notify机制保持一致，当一个线程阻塞在某个对象的monitor上时，如果此时直接在该线程上调用interrupt方法，那么该线程就会抛出InterruptedException，在这里线程已经不持有锁的Condition的了，所以不需要抛出异常，只需要在最后重新还原它的中断标记即可（因为Thread.interrupted()会改变中断标记）**。

#### reportInterruptAfterWait(int interruptMode)

```java
private void reportInterruptAfterWait(int interruptMode)
    throws InterruptedException {
    // 如果是在调用signal或者signalAll方法之前中断的，则抛出InterruptedException，对应wait/notify机制
    if (interruptMode == THROW_IE)
        throw new InterruptedException();
    // 如果是唤醒之后才中断的则还原中断标记，对应wait/notify机制
    else if (interruptMode == REINTERRUPT)
        selfInterrupt();
}
```

reportInterruptAfterWait方法抛出中断异常的逻辑和Object的wait/notify机制保持一致，只有在线程阻塞期间中断才会抛出异常，正常运行期间被中断只需要还原中断标记就可以了。

### await总结

下面对await方法做一个总结

1. 调用该方法的线程如果处于中断状态，则会立马抛出InterruptedException，这和wait/notify保持一致
2. await方法调用必须保证当前线程拥有该Condition的锁，否则会抛出IllegalMonitorStateException，详情见fullyRelease方法
3. 当前线程调用该方法后会先释放自己拥有的锁，然后进入到一个条件队列中，除非其它线程调用signal、signalAll方法或者当前线程被中断得以被转移到AQS的clh队列中当前线程才能得以运行，否则的话会一直阻塞。最终方法结束时会根据线程在阻塞期间是否被阻塞过以及阻塞的时机来选择是否抛出InterruptedException还是重置中断标记。这和Object的wait/notify机制保持一致。

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

其中while能够再次循环需要满足当前正在循环的第一个节点能够成功转移到clh队列中，如果不能就一直往后找直到找到一个不为null且能够转移到clh队列中的节点为止。主要的唤醒逻辑在transferForSignal方法中，

#### transferForSignal(Node node)

返回是否能够将条件队列中的第一个节点转移到clh队列中

```java
final boolean transferForSignal(Node node) {
    // 条件队列中的节点状态肯定为CONDITION，只要cas成功那么代表转移成功了。
    // 不清楚什么情况下cas会失败（节点被取消了？）
    if (!compareAndSetWaitStatus(node, Node.CONDITION, 0))
        return false;

    // 节点状态改变成功后，就可以将其入队了，然后返回入队后的前一个节点
    Node p = enq(node);
    // 前一个节点的状态
    int ws = p.waitStatus;
    // 如果前一个节点被取消了，或者这个时候尝试将其状态修改为SIGNAL失败的话，就立马让该节点中的线程开始运行
    // 至于为什么需要将前一个节点的状态修改为SIGNAL，在AQS独占模式中一个节点被唤醒是通过前驱节点唤醒的，
    // 在release方法中有一个if判断
    //	if (h != null && h.waitStatus != 0)
    //            unparkSuccessor(h);
    // clh头部节点状态不为0才会去唤醒下一个节点，而条件队列中的节点进入clh队列中，状态会被修改为0，同时节点状     // 态为SIGNAL也表明需要唤醒下一个节点
    if (ws > 0 || !compareAndSetWaitStatus(p, ws, Node.SIGNAL))
        // 这一步直接让刚入队的线程直接运行，我猜测可能是一种尝试机制，因为即便线程开始运行，在await方法中
        // 会调用acquireQueued方法再次尝试获取锁，如果获取失败依旧会被阻塞，所以是无害的
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
    // 等待截止时间=当前时间+输入的纳秒时间。
    // 可以理解为这个方法
    final long deadline = System.nanoTime() + nanosTimeout;
    int interruptMode = 0;
    while (!isOnSyncQueue(node)) {
        // 能够执行到这一步判断，肯定是以下两种情况之一：
        // 1、参数就是小于0（第一次循环），那么就不需要等待，直接进入clh队列然后跳出while循环
        // 2、正常醒来（parkNanos时间过后，此刻还没有进入clh队列），由于执行parkNanos下面的代码需要时间，
        // 所以nanosTimeout肯定也是负数，这个时候由于已经过了nanosTimeout时间，所以需要进入clh队列然后跳出	    // while循环
        if (nanosTimeout <= 0L) {
            transferAfterCancelledWait(node);
            break;
        }
        // 这一步的判断我猜测可能是因为执行上面代码需要一些时间，虽然很短，姑且就认为是
        // spinForTimeoutThreshold(1000L)纳秒，只有传参超过这个值，才会执行阻塞方法让线程
        // 停车指定的纳秒时间，大概是为了提高性能吧。
        if (nanosTimeout >= spinForTimeoutThreshold)
            LockSupport.parkNanos(this, nanosTimeout);
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
        // 执行到这一步线程肯定是被唤醒了，至于是正常醒来还是提前唤醒的就不得而知的，
        // 如果是提前被唤醒（肯定已经在clh队列里面了，下次会跳出while循环）此刻nanosTimeout正负不确定，
        // 如果是正常醒来（肯定不在clh队列里面）因为上面的中断判断会导致花费了一点时间
        // 最终nanosTimeout肯定为负数，不过无关紧要下一次的while循环会判断是否在clh队列以及nanosTimeout
        // 是否为负数来保证跳出循环的。
        nanosTimeout = deadline - System.nanoTime();
    }
    if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
        interruptMode = REINTERRUPT;
    if (node.nextWaiter != null)
        unlinkCancelledWaiters();
    if (interruptMode != 0)
        reportInterruptAfterWait(interruptMode);
    // deadline代表的是线程等待的截止时间，System.nanoTime()代表的是当前时间，两者相减其实没什么太大的意义，
    // 只能说返回结果大于0说明线程从await到signal过程花费的时间没有超过nanosTimeout，
    // 返回结果小于0说明线程从await到signal过程花费的时间超过nanosTimeout，
    return deadline - System.nanoTime();
}
```

awaitNanos方法提供了类似Object的`wait(long timeout)`方法的定时等待功能。返回值是剩余可等待纳秒数的估计值，不是已经花费的时间。返回值小于或等于零表示没有剩余时间；返回后仍需检查业务条件。

### awaitUntil(Date deadline)

awaitUntil提供了定时等待的功能，等待到指定时间后，线程会被自动唤醒。

```java
public final boolean awaitUntil(Date deadline)
    throws InterruptedException {
    // 指定时间的毫秒数
    long abstime = deadline.getTime();
    if (Thread.interrupted())
        throw new InterruptedException();
    Node node = addConditionWaiter();
    int savedState = fullyRelease(node);
    // timedout代表的是在到达deadline之后有没有被唤醒，换句话说就是线程有没有在
    // deadline之前被其它线程调用signal或者signalAll方法
    boolean timedout = false;
    int interruptMode = 0;
    while (!isOnSyncQueue(node)) {
        // 能够执行到这一步判断，肯定是以下两种情况之一：
        // 1、当前时间大于入参本身（第一次循环），那么就不需要等待，直接进入clh队列然后跳出while循环。
        // 2、正常醒来（parkUntil时间过后，此刻还没有进入clh队列），由于执行parkUntil下面的代码需要时间，
        // 所以此刻当前时间肯定大于abstime，所以需要进入clh队列然后跳出while循环。
        if (System.currentTimeMillis() > abstime) {
            // 回顾一下transferAfterCancelledWait方法，返回true代表线程进入clh队列是在
            // signal之前，返回false是在signal之后，结合能够进入这个if判断的情况：
            // timedout为true说明在到达deadline都还没有其它线程调用唤醒方法,
            // timedout为false说明在到达deadline已经有其它线程调用唤醒方法。
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
    // 有点绕，在下面做一个总结
    return !timedout;
}
```

awaitUntil提供了定时等待的功能，到达指定的时间点后，线程会自动唤醒，这里有一个混淆点，虽然线程会在LockSupport.parkUntil方法到达指定时间点后自动被唤醒，但是由于下方的acquireQueued方法依旧会去尝试获取锁，如果此刻其它线程还拥有锁，那么当前线程依旧会被阻塞在clh队列中。还有一个比较难理解的是这个方法的返回值。下面直接对其做一个总结，不明白的可以对照着上面注释理解。

* **方法返回true，表示等待未超时；仍需要重新检查业务条件。中断按方法契约抛出 InterruptedException，不能解释为返回 true**
* **方法返回false，代表的意思是在达到deadline时间点之前没有其它线程调用signal或者signalAll方法**

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

Condition结合Lock模拟了Object中的wait/notify机制，并且提供了更为丰富的功能，例如提供了不响应中断的awaitUninterruptibly方法，提供了按入队顺序唤醒线程的signal方法等等。其中最重要的一个不同之处在于每一个Object只拥有一个monitor而Lock是可以构造多个不同的Condition的。

## 资料来源

- [Condition：等待、通知与超时返回值](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Condition.html)
- [ReentrantLock.newCondition：通知与锁获取顺序](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html#newCondition())
