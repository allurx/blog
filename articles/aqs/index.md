---
title: AbstractQueuedSynchronizer
date: 2019-09-02
updated: 2026-10-02
tags:
  - Java
  - Concurrent
  - Lock
  - AQS
domain: Java
---

AQS 把同步状态与等待队列管理分开：子类定义独占或共享获取、释放的规则，框架负责排队、阻塞、唤醒与取消。FIFO 等待队列不自动等于公平获取，`state` 的含义也由同步器定义，不能统一理解为重入次数。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java) 为源码基线，分析独占与共享钩子、等待节点及队列操作。子类负责定义同步状态的含义和获取协议，AQS 负责等待管理；常见锁与同步工具已有合适实现时，直接使用它们。


## AbstractOwnableSynchronizer

AbstractQueuedSynchronizer继承了AbstractOwnableSynchronizer，记录在独占模式下获取锁的线程对象。

```java
package java.util.concurrent.locks;

public abstract class AbstractOwnableSynchronizer
    implements java.io.Serializable {

    private static final long serialVersionUID = 3737899427754241961L;

    protected AbstractOwnableSynchronizer() { }

    // 当前拥有独占锁的线程
    private transient Thread exclusiveOwnerThread;

    // 设置当前拥有独占访问权限的线程
    protected final void setExclusiveOwnerThread(Thread thread) {
        exclusiveOwnerThread = thread;
    }

    // 获取当前拥有独占访问权限的线程
    protected final Thread getExclusiveOwnerThread() {
        return exclusiveOwnerThread;
    }
}

```

AbstractOwnableSynchronizer仅仅维护了一个Thread类型的变量，代表在独占模式下当前获取锁的线程。

## AbstractQueuedSynchronizer

AQS控制多线程访问共享资源使用的算法是基于CLH锁算法的一种变体算法，有关CLH锁算法的实现原理可以参考我之前写的一篇博客[锁算法](/spin-clh-mcs-locks/)。同时AQS对于多线程的访问控制有两种模式，分别是
* 独占模式
  例如写文件时只能有一个线程在写。基于此的实现有ReentrantLock
* 共享模式
  例如读文件时可以有多个线程同时在读。基于此的实现有CountDownLatch

在这两种模式下当前访问共享资源的线程都是通过其内部类Node来存放的，然后将这些Node组成一个FIFO（先进先出）的双向链表。这里的 AQS 实现中定义了链表头尾节点与同步状态 state；state 的含义由具体同步器决定，可表示重入次数、剩余许可或倒计数等

```java
// 头部节点
private transient volatile Node head;
// 尾部节点
private transient volatile Node tail;
// 线程重入的次数
private volatile int state;
```

AQS是通过CAS高效的往链表尾部添加新的节点。同时AQS给不同的同步组件提供了一些通用的方法来定义线程应当以如何去获取共享资源，我们自己定义同步组件时主要需要重写以下几个方法

* isHeldExclusively()
  当前线程是否独占资源，一般只有自定义Condition的时候才需要重写该方法
* tryAcquire(int arg)
  以独占模式获取共享资源，成功返回true，失败返回false。
* tryAcquireShared(int arg)
  返回负数表示获取失败，零表示获取成功但后续共享获取不能成功，正数表示获取成功且后续共享获取可能成功。返回值是 int，不是 boolean。
* tryRelease(int arg)
  返回 true 表示资源已完全释放，可以尝试唤醒等待者；可重入锁只减少部分重入计数时返回 false。
* tryReleaseShared(int arg)
  返回 true 表示本次释放可能允许等待的共享获取成功，需要传播通知。
### Node

Node是AQS的内部静态类，同步队列就是基于此构成的

```java
static final class Node {

	// 标记表明当前当前节点是否处于共享模式，没什么实际作用，主要是标记作用
    static final Node SHARED = new Node();

    // 标记表明当前当前节点是否处于独占模式，没什么实际作用，主要是标记作用
    static final Node EXCLUSIVE = null;

    // 线程已取消的状态值
    static final int CANCELLED =  1;

    // 线程执行完毕后需要通知队列中下一个节点中的线程开始运行（独占模式）
    static final int SIGNAL    = -1;

    // 线程正在等待Condition

    static final int CONDITION = -2;

    // 下一个执行acquireShared方法的线程能够无条件的执行（共享模式）
    static final int PROPAGATE = -3;

    // 等待状态还可以是零；零表示当前没有上述等待协议标记。
    volatile int waitStatus;

    // 前一个结点
    volatile Node prev;

    // 下一个节点
    volatile Node next;

    // 当前正在排队的线程（需要访问共享资源然后被包装成Node放入队列中）
    volatile Thread thread;

    // 有两个用处
    // 1.用于条件队列（Condition），指向下一个等待Condition的节点，形成单向链表
    // 2.标识符用来表明当前当前处于什么模式下，查看isShared()方法中的判断逻辑，因为在
    // 构造独占模式节点时通过addWaiter方法传入的Node.EXCLUSIVE（null），而构造共享模式
    // 节点传入的是Node.SHARED（不为null），所以可以根据这个值来判断当前处于什么模式下
    Node nextWaiter;

    // 判断当前节点是否处于共享模式下
    final boolean isShared() {
        return nextWaiter == SHARED;
    }

    // 返回前一个节点，注意如果前一个节点为null，该方法会抛出空指针异常
    final Node predecessor() throws NullPointerException {
        Node p = prev;
        if (p == null)
            throw new NullPointerException();
        else
            return p;
    }

	// 用来初始化头节点和共享节点的构造函数
    Node() {
    }

    // 用来往队列中添加节点的构造函数
    Node(Thread thread, Node mode) {
        this.nextWaiter = mode;
        this.thread = thread;
    }

	// 使用Condition的构造函数
    Node(Thread thread, int waitStatus) {
        this.waitStatus = waitStatus;
        this.thread = thread;
    }
}
```

### acquire(int arg)

acquire方法是独占模式下当前线程获取锁的方法，是AQS提供的顶级方法，内部的实现是根据子类的返回结果来选择是否应该将当前线程排队（阻塞获取锁的线程），主要分为三个部分

```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```
* !tryAcquire(arg)==true
  代表子类定义的获取条件此刻不满足，不一定意味着资源被另一个线程独占。
* addWaiter(Node.EXCLUSIVE)
  添加独占模式Node到链表尾部
* acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
  确定当前节点的上一个节点的waitStatus是SIGNAL，然后禁用cpu调度当前节点的线程。

acquire方法由三个子方法组成，暂时看不懂这个方法的作用是什么没关系，接下来我们一个一个分析这三个方法。

#### tryAcquire(arg)

```java
protected boolean tryAcquire(int arg) {
    throw new UnsupportedOperationException();
}
```

这个方法需要子类重写，判断在独占模式下当前线程是否能够获取锁，返回true表明当前线程能够获取锁，false表明不能 获取锁。

#### addWaiter(Node mode)

将当前获取锁的线程构造成Node添加到链表尾部

```java
private Node addWaiter(Node mode) {
    // 以给定的模式构造Node
    Node node = new Node(Thread.currentThread(), mode);
    // 获取尾部Node
    Node pred = tail;
    // 这一步是假设此时没有其它线程在竞争，直接将Node添加到尾部，
    // 其实这一步在下面的enq方法中已经判断过了，作者估计是为了效率牺牲了代码的简洁性
    if (pred != null) {
        node.prev = pred;
        // cas设置尾部节点为pred
        if (compareAndSetTail(pred, node)) {
            pred.next = node;
            return node;
        }
    }
    // 完整的排队方法
    enq(node);
    return node;
}
```

addWaiter的作用是将当前获取锁的线程构造成Node添加到链表尾部，其中为了性能的追求，第一个if判断将enq方法中的一种可能性提取了出来，这个方法的返回值是刚刚被添加到尾部的节点。下面我们接着看完整情况的入队enq方法。

##### enq(final Node node)

```java
private Node enq(final Node node) {
    // 死循环
    for (;;) {
        // 获取尾部节点
        Node t = tail;
        // 初始化，cas设置头部节点和尾部节点
        if (t == null) {
            if (compareAndSetHead(new Node()))
                tail = head;
        // 队列中已经存在节点
        } else {
            // 将新节点的前一个节点指向尾部节点
            // 这一步没必要cas，因为即使下一步的cas失败了，下一次的for循环总能取到最新的尾部节点
            node.prev = t;
            // cas设置尾部节点为新节点
            if (compareAndSetTail(t, node)) {
                t.next = node;
                return t;
            }
        }
    }
}
```

1. 如果当前队列没有节点则初始化头部和尾部节点
2. 如果队列中存在节点则cas将新节点设置为队列尾部节点

注意enq方法返回的成功设置为尾部的节点的前一个节点（也可以理解为前一个尾部节点）

#### acquireQueued(final Node node, int arg)

这个方法的作用是为即将要添加到链表尾部的节点设置上一个能够通知自己接下来能够执行的节点，然后再设置该节点的线程状态为waiting（禁用cpu调度）

```java
final boolean acquireQueued(final Node node, int arg) {
    // 操作是否失败的标记
    boolean failed = true;
    try {
        // 执行该方法的线程在排队过程中是否被中断过
        boolean interrupted = false;
        for (;;) {
            // 获取该节点的前一个节点，只要是头部节点并且该线程能够获取资源（tryAcquire返回true），
            // 就将该节点设置头部节点
            final Node p = node.predecessor();
            if (p == head && tryAcquire(arg)) {
                setHead(node);
                p.next = null; // help GC
                failed = false;
                return interrupted;
            }
            // 走到这一步表明节点此刻无法获取锁，接下来在队列中需要找一个合适的位置，
            // 然后阻塞该节点的线程，注意线程被唤醒后会继续for循环
            if (shouldParkAfterFailedAcquire(p, node) &&
                parkAndCheckInterrupt())
                interrupted = true;
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
```

acquireQueued在第一次for循环中先判断当前节点线程是否能够获取锁，如果能够的话则直接返回，如果不能的话会调用shouldParkAfterFailedAcquire和parkAndCheckInterrupt方法来对该节点进行一些处理

##### shouldParkAfterFailedAcquire(Node pred, Node node)

```java
private static boolean shouldParkAfterFailedAcquire(Node pred, Node node) {
    int ws = pred.waitStatus;
    if (ws == Node.SIGNAL)
        /*
         * This node has already set status asking a release
         * to signal it, so it can safely park.
         */
        return true;
    if (ws > 0) {
        /*
         * Predecessor was cancelled. Skip over predecessors and
         * indicate retry.
         */
        do {
            node.prev = pred = pred.prev;
        } while (pred.waitStatus > 0);
        pred.next = node;
    } else {
        /*
         * waitStatus must be 0 or PROPAGATE.  Indicate that we
         * need a signal, but don't park yet.  Caller will need to
         * retry to make sure it cannot acquire before parking.
         */
        compareAndSetWaitStatus(pred, ws, Node.SIGNAL);
    }
    return false;
}
```

##### parkAndCheckInterrupt

```java
private final boolean parkAndCheckInterrupt() {
    LockSupport.park(this);
    return Thread.interrupted();
}
```

这个方法是用来阻塞当前线程的，返回当前线程在阻塞过程中是否被中断过。注意Thread.interrupted()这个方法会改变线程的中断状态。有关线程的中断状态以及LockSupport的使用可以参考我之前写的博客[LockSupport](/lock-support/)，[Thread常用方法](/thread-methods/)。我们再回头看acquireQueued方法中的这段代码

```java
if (shouldParkAfterFailedAcquire(p, node) &&
    parkAndCheckInterrupt())
    interrupted = true;
```

1. shouldParkAfterFailedAcquire(p, node)返回true表明当前节点的前驱节点的状态为SIGNAL，说明前驱节点执行完毕后会通知后面一个节点开始执行，接下来可以阻塞该节点的线程了。
2. parkAndCheckInterrupt()返回true表明在该节点阻塞的过程中被中断过了。
3. 这两个方法同时返回true，并且此刻线程已经被唤醒了（if语句块的代码继续运行），说明阻塞的过程中被中断过了，然后将interrupted值设置为true。

下面对acquireQueued方法做一个总结：

1. 当前节点成为头节点的后继后才尝试获取；成功时设置新头节点，并返回等待期间累计的中断标记。
2. 如果不能获取锁，调用shouldParkAfterFailedAcquire方法过滤掉状态为CANCELLED的节点，依靠for循环挂靠在其前一个正常的节点上，等待第二次for循环后设置前驱节点状态为SIGNAL
3. 在第二步返回true的情况下调用parkAndCheckInterrupt方法阻塞当前线程，直到前驱节点通知其运行

`acquireQueued` 直到成功获取资源才返回，返回值记录等待期间是否检测到中断。准备阻塞时先让前驱承担通知责任，再重试获取，避免检查失败与真正停车之间丢失唤醒；前驱状态还会被释放者并发修改，SIGNAL 并非整个阻塞期间不变的事实。

我们现在再重新回到一开始的acquire(int arg) 方法上来

```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```

现在我们已经可以清晰的理解acquire方法的含义了，总结一句话就是：

**如果当前线程获取不到锁并且在入队后的阻塞期间被中断过的话（因为判断调用是Thread.interrupted()方法会改变线程的中断状态，需要重新设置回来）就重新设置该线程的中断状态**

### acquireInterruptibly(int arg)

acquireInterruptibly方法同样是以独占模式获取锁，与acquire方法的唯一不同之处在于acquire方法会忽略线程排队期间的中断，而acquireInterruptibly方法则会抛出InterruptedException异常如果线程在排队期间发生过中断的话。

```java
public final void acquireInterruptibly(int arg)
    throws InterruptedException {
    // 调用该方法的线程如果已经设置过中断标记，则直接抛出InterruptedException异常
    if (Thread.interrupted())
        throw new InterruptedException();
    // 线程获取不到锁，将线程入队
    if (!tryAcquire(arg))
        doAcquireInterruptibly(arg);
}
```

#### doAcquireInterruptibly(int arg)

```java
private void doAcquireInterruptibly(int arg)
    throws InterruptedException {
    final Node node = addWaiter(Node.EXCLUSIVE);
    boolean failed = true;
    try {
        for (;;) {
            final Node p = node.predecessor();
            if (p == head && tryAcquire(arg)) {
                setHead(node);
                p.next = null; // help GC
                failed = false;
                return;
            }
            if (shouldParkAfterFailedAcquire(p, node) &&
                parkAndCheckInterrupt())
                // 线程排队期间如果发生过中断，被唤醒后直接抛出InterruptedException
                throw new InterruptedException();
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
```

doAcquireInterruptibly方法和acquireQueued方法大同小异，唯一的不同之处在于`if (shouldParkAfterFailedAcquire(p, node) && parkAndCheckInterrupt())`这个判断，阻塞的线程被唤醒后直接被抛出了InterruptedException异常，然后进入到finally语句块。

### release(int arg)

```java
public final boolean release(int arg) {
    // tryRelease方法由子类实现，返回true代表释放锁
    if (tryRelease(arg)) {
        // 获取链表中的头部节点
        Node h = head;
        // 头部节点不为null并且不是取消状态的话则调用unparkSuccessor方法通知下一个节点的线程开始
        // 运行，内部是通过调用LockSupport.unpark方法使shouldParkAfterFailedAcquire方法中被阻塞的
        // 下一个线程开始运行
        if (h != null && h.waitStatus != 0)
            unparkSuccessor(h);
        return true;
    }
    return false;
}
```

release方法是通过独占模式的方式解锁等待队列中的一个或者多个线程。当tryRelease方法返回true则开始唤醒队列中的下一个线程。注意这个tryRelease方法是由AQS的子类实现的。解锁的关键之处在于unparkSuccessor方法，下面我们就来分析一下这个方法是如何唤醒下一个线程的。

#### unparkSuccessor(Node node)

```java
private void unparkSuccessor(Node node) {
    int ws = node.waitStatus;
    // 如果该节点的状态小于0就重新设置其状态为0，确保调用这个方法代表该节点已经完成了
    if (ws < 0)
        compareAndSetWaitStatus(node, ws, 0);
    // 获取该节点（头部节点）的下一个节点
    Node s = node.next;
    // 如果下一个节点为null或者状态为已取消就从尾部开始往前找最靠近头部的一个不是取消状态的节点
    if (s == null || s.waitStatus > 0) {
        s = null;
        for (Node t = tail; t != null && t != node; t = t.prev)
            if (t.waitStatus <= 0)
                s = t;
    }
    // 找到这个节点后，调用LockSupport.unpark唤醒这个节点中的线程
    if (s != null)
        LockSupport.unpark(s.thread);
}
```

`unparkSuccessor` 先尝试把传入节点的负状态清为零，再寻找未取消的后继；直接后继不可用时，从尾部沿 prev 回查。零不是“执行完成”的标记。最后通过 unpark 提供许可，让选中的线程重新参与获取。

### acquireShared(int arg)

```java
public final void acquireShared(int arg) {
    if (tryAcquireShared(arg) < 0)
        doAcquireShared(arg);
}
```

以共享模式获取锁，如果无法获取锁，对应的线程将会被排队。

#### tryAcquireShared(int arg)

该钩子由子类实现。负数表示失败，零表示成功但后续共享获取不能成功，正数表示成功且后续共享获取可能成功。结果描述获取协议，不一定等于某种可数资源的剩余数量。

#### doAcquireShared(int arg)

当线程在共享模式下获取锁失败时，调用该方法给需要排队的线程寻找合适的位置以及给线程排队。同时忽略阻塞期间的中断。

```java
private void doAcquireShared(int arg) {
        // 以共享模式构造节点添加到队列尾部
        final Node node = addWaiter(Node.SHARED);
        boolean failed = true;
        try {
            boolean interrupted = false;
            // 注意这里的for循环，线程被唤醒后会继续从此处开始执行
            for (;;) {
                // 获取前一个节点
                final Node p = node.predecessor();
                // 如果是头部节点（正在运行的线程节点）
                // 从头部往后依次唤醒
                if (p == head) {
                    // 判断是否还有共享资源
                    int r = tryAcquireShared(arg);
                    // 如果没有共享资源了，从头部节点开始依次唤醒节点
                    if (r >= 0) {
                        // 将当前线程节点设置为头节点并唤醒接下来的共享节点
                        setHeadAndPropagate(node, r);
                        p.next = null; // help GC
                        // 如果在阻塞期间发生过中断就重新设置一下中断标记
                        if (interrupted)
                            selfInterrupt();
                        failed = false;
                        return;
                    }
                }
                // 寻找合适的阻塞位置以及阻塞当前线程
                if (shouldParkAfterFailedAcquire(p, node) &&
                    parkAndCheckInterrupt())
                    interrupted = true;
            }
        // 期间发生异常
        } finally {
            if (failed)
                cancelAcquire(node);
        }
    }
```

doAcquireShared方法与独占模式下的acquireQueued方法实现逻辑上有很多相似之处，他们都忽略了线程阻塞期间的中断，只不过在共享模式下当线程获取锁后不仅仅会设置当前线程节点为头部节点，还会去唤醒当前节点的下一个处于共享模式的节点。

#### setHeadAndPropagate(Node node, int propagate)

```java
private void setHeadAndPropagate(Node node, int propagate) {
    // 老的头部节点
    Node h = head;
    // 重新设置头部节点为当前获取锁的线程所在的节点
    setHead(node);
    // 如果还有剩余资源或者头部节点不是取消状态
    if (propagate > 0 || h == null || h.waitStatus < 0 ||
        (h = head) == null || h.waitStatus < 0) {
        Node s = node.next;
        // 当前获取锁的线程所在的节点的下一个节点不为null或者是共享节点就唤醒该节点
        if (s == null || s.isShared())
            doReleaseShared();
    }
}
```

setHeadAndPropagate方法的作用是将当前获取锁的线程所在的节点设置为头节点并且根据这节点获取锁的结果（是否还有共享资源）以及老的头部节点的状态（不是取消状态）来解锁下一个处于共享模式的节点。

### acquireSharedInterruptibly(int arg)

acquireSharedInterruptibly方法同样是以共享模式获取锁，与acquireShared方法的唯一不同之处在于acquireShared方法会忽略线程排队期间的中断，而acquireSharedInterruptibly方法则会抛出InterruptedException异常如果线程在排队期间发生过中断的话。

```java
public final void acquireSharedInterruptibly(int arg)
    throws InterruptedException {
    // 调用该方法的线程如果已经设置过中断标记，则直接抛出InterruptedException异常
    if (Thread.interrupted())
        throw new InterruptedException();
    // 线程获取不到锁，将线程入队
    if (tryAcquireShared(arg) < 0)
        doAcquireSharedInterruptibly(arg);
}
```

#### doAcquireSharedInterruptibly(int arg)

```java
private void doAcquireSharedInterruptibly(int arg)
    throws InterruptedException {
    final Node node = addWaiter(Node.SHARED);
    boolean failed = true;
    try {
        for (;;) {
            final Node p = node.predecessor();
            if (p == head) {
                int r = tryAcquireShared(arg);
                if (r >= 0) {
                    setHeadAndPropagate(node, r);
                    p.next = null; // help GC
                    failed = false;
                    return;
                }
            }
            // 线程排队期间如果发生过中断，被唤醒后直接抛出InterruptedException
            if (shouldParkAfterFailedAcquire(p, node) &&
                parkAndCheckInterrupt())
                throw new InterruptedException();
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
```

doAcquireSharedInterruptibly方法和doAcquireShared方法大同小异，唯一的不同之处在于`if (shouldParkAfterFailedAcquire(p, node) && parkAndCheckInterrupt())`这个判断，阻塞的线程被唤醒后直接被抛出了InterruptedException异常，然后进入到finally语句块。

### releaseShared(int arg)

```java
public final boolean releaseShared(int arg) {
    // 该方法由子类实现，如果能够释放资源成功则开始唤醒所有阻塞线程
    if (tryReleaseShared(arg)) {
        doReleaseShared();
        return true;
    }
    return false;
}
```

#### doReleaseShared

```java
private void doReleaseShared() {
    /*
     * Ensure that a release propagates, even if there are other
     * in-progress acquires/releases.  This proceeds in the usual
     * way of trying to unparkSuccessor of head if it needs
     * signal. But if it does not, status is set to PROPAGATE to
     * ensure that upon release, propagation continues.
     * Additionally, we must loop in case a new node is added
     * while we are doing this. Also, unlike other uses of
     * unparkSuccessor, we need to know if CAS to reset status
     * fails, if so rechecking.
     */
    for (;;) {
        Node h = head;
        if (h != null && h != tail) {
            int ws = h.waitStatus;
            if (ws == Node.SIGNAL) {
                if (!compareAndSetWaitStatus(h, Node.SIGNAL, 0))
                    continue;            // loop to recheck cases
                unparkSuccessor(h);
            }
            else if (ws == 0 &&
                     !compareAndSetWaitStatus(h, 0, Node.PROPAGATE))
                continue;                // loop on failed CAS
        }
        if (h == head)                   // loop if head changed
            break;
    }
}
```

`doReleaseShared` 在头节点为 SIGNAL 时清除通知标记并唤醒后继；状态为零时设为 PROPAGATE，记录共享释放还需要向后传播。头节点可能在并发获取时改变，循环与 `setHeadAndPropagate` 配合，避免释放与新头节点就位交错后遗漏通知。

## 例子

下面实现一个非重入互斥锁：state 为 1 表示已锁定，0 表示未锁定。除状态外还检查拥有者，防止其他线程错误地 unlock 或 signal；isLocked 只用于观察是否上锁，不代表当前线程持有锁。

```java
package io.allurx;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.AbstractQueuedSynchronizer;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.Lock;

/**
 * @author allurx
 */
public class Mutex implements Lock {

    private static class Sync extends AbstractQueuedSynchronizer {

        // 是否持有锁
        @Override
        protected boolean isHeldExclusively() {
            return getState() == 1 && getExclusiveOwnerThread() == Thread.currentThread();
        }

        // 尝试获取锁
        @Override
        public boolean tryAcquire(int acquires) {
            assert acquires == 1;
            if (compareAndSetState(0, 1)) {
                setExclusiveOwnerThread(Thread.currentThread());
                return true;
            }
            return false;
        }

        // 尝试释放锁
        @Override
        protected boolean tryRelease(int releases) {
            assert releases == 1;
            if (!isHeldExclusively()) {
                throw new IllegalMonitorStateException();
            }
            setExclusiveOwnerThread(null);
            setState(0);
            return true;
        }

        boolean isLocked() {
            return getState() != 0;
        }

        // 为持有锁的线程提供条件等待
        Condition newCondition() {
            return new ConditionObject();
        }

    }

    private final Sync sync = new Sync();

    @Override
    public void lock() {
        sync.acquire(1);
    }

    @Override
    public boolean tryLock() {
        return sync.tryAcquire(1);
    }

    @Override
    public void unlock() {
        sync.release(1);
    }

    @Override
    public Condition newCondition() {
        return sync.newCondition();
    }

    public boolean isLocked() {
        return sync.isLocked();
    }

    public boolean hasQueuedThreads() {
        return sync.hasQueuedThreads();
    }

    @Override
    public void lockInterruptibly() throws InterruptedException {
        sync.acquireInterruptibly(1);
    }

    @Override
    public boolean tryLock(long timeout, TimeUnit unit)
            throws InterruptedException {
        return sync.tryAcquireNanos(1, unit.toNanos(timeout));
    }
}
```

Mutex例子给出了常用同步器的定义模板，一般情况下如果我们需要自定义自己的同步器，我们只需要定义一个内部类继承AbstractQueuedSynchronizer，对于以独占模式工作的同步器来说我们只需要实现tryAcquire、tryRelease方法即可，对于以共享模式工作的同步器来说我们只需要实现tryAcquireShared、tryReleaseShared方法即可，线程的入队和出队的操作AQS已经帮我们实现了。下面我们测试一下Mutex类的准确性。

```java
package io.allurx;


/**
 * @author allurx
 */
public class DemoApplication {

    private static int n = 0;

    private static Mutex mutex = new Mutex();

    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(new Worker());
        Thread t2 = new Thread(new Worker());
        Thread t3 = new Thread(new Worker());
        t1.start();
        t2.start();
        t3.start();
        t1.join();
        t2.join();
        t3.join();
        System.out.println(n);
    }

    static class Worker implements Runnable {

        @Override
        public void run() {
            for (int i = 0; i < 100000; i++) {
                mutex.lock();
                try {
                    n++;
                } finally {
                    mutex.unlock();
                }
            }
        }
    }

}
```

控制台输出

```java
300000
```

开启三个线程对静态变量n进行非原子性的自增操作，通过Mutex在自增操作的前后加锁和解锁，最终结果和预期一致。

## 总结

AQS 通过同步状态、FIFO 等待队列和 LockSupport 管理获取失败后的等待。子类钩子决定独占或共享语义，队列本身不保证公平；取消、中断和共享传播负责让排队过程与实际获取协议保持一致。

## 资料来源

- [AbstractQueuedSynchronizer：状态、钩子与公平性](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)
