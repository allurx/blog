---
title: AbstractQueuedSynchronizer
date: 2019-09-02
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - Lock
  - AQS
domain: Java
---

AQS（AbstractQueuedSynchronizer）解决的是“获取条件暂时不满足时，如何排队、等待、重试和取消”。它不预先规定锁的含义：子类定义同步状态与获取规则，框架维护等待过程。理解这条分工，比把 AQS 简化成一把 FIFO 锁更有用。

本文沿独占获取、释放通知、共享传播和自定义互斥锁四条路径阅读 [OpenJDK 8u202-b08 源码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java)。需要先了解 [CAS](/cas/)、[线程中断](/thread-methods/) 和 [LockSupport 的许可](/lock-support/)。完整用法示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。内部源码仍按 OpenJDK 8u202-b08 研究，不能把旧字段布局当作新版 JDK 的实现承诺。

## 先分清同步状态、拥有者和等待队列

state 是一个 volatile int，通过 getState、setState 和 compareAndSetState 访问。它可以表示重入次数、信号量剩余许可或锁存器倒计数，含义由子类决定。AbstractOwnableSynchronizer 的 exclusiveOwnerThread 另行记录独占拥有者；写入这个字段本身不会建立互斥，必须与同步状态协议配合。

等待队列的 head 通常是一个不再代表等待线程的哨兵，tail 指向最后入队的节点。节点沿 prev、next 连接，成功获取后的节点成为新 head。队列先后关系提供排队基础，却不阻止子类在首次 tryAcquire 时让新线程插队；[ReentrantLock 的公平策略](/reentrant-lock/)就是在子类中决定的。

| 子类钩子 | 返回值的含义 |
| --- | --- |
| tryAcquire(arg) | true 表示独占获取成功 |
| tryRelease(arg) | true 表示资源完全释放，可以通知后继 |
| tryAcquireShared(arg) | 负数失败；零成功但不允许进一步共享获取；正数成功且后续可能成功 |
| tryReleaseShared(arg) | true 表示本次释放可能使共享获取成功，需要传播 |
| isHeldExclusively() | 当前线程是否独占持有资源，供条件等待等操作检查 |

这些钩子必须正确处理并发状态；AQS 不会替子类推断业务条件。默认钩子抛出 UnsupportedOperationException，因此只实现实际使用的独占或共享协议。

## 独占获取：先尝试，失败后才入队

获取入口只有三个动作：尝试获取、把当前线程加入队列、在队列中等待到成功。acquire 不因中断取消获取，而是在最终成功后恢复等待期间观察到的中断标记。

```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```

addWaiter 先尝试直接连接到现有队尾，失败才进入 enq 的循环。入队过程中先设置新节点的 prev，再 CAS 更新 tail，最后连接前驱的 next。由于这些动作不是一次原子修改，其他线程可能暂时看到 tail 已更新、next 尚未连接；后续遍历必须考虑这种窗口。

```java
private Node enq(final Node node) {
    for (;;) {
        Node t = tail;
        if (t == null) {
            if (compareAndSetHead(new Node()))
                tail = head;
        } else {
            node.prev = t;
            if (compareAndSetTail(t, node)) {
                t.next = node;
                return t;
            }
        }
    }
}
```

入队并不意味着马上停车。acquireQueued 每轮先判断前驱是否为 head；只有成为 head 的后继时才尝试获取。成功后更新 head 并解除旧头的 next 引用；失败则准备等待。

```java
final boolean acquireQueued(final Node node, int arg) {
    boolean failed = true;
    try {
        boolean interrupted = false;
        for (;;) {
            final Node p = node.predecessor();
            if (p == head && tryAcquire(arg)) {
                setHead(node);
                p.next = null; // help GC
                failed = false;
                return interrupted;
            }
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

## 为什么要先设置前驱的 SIGNAL，再重新尝试

这里的 waitStatus 描述节点参与等待协议的状态，不是 Thread.State，也不是任务完成状态。

| 状态 | 本版本中的用途 |
| --- | --- |
| 0 | 没有下面的等待标记 |
| SIGNAL（-1） | 后继准备等待，需要本节点在释放或取消时承担通知责任 |
| CANCELLED（1） | 本节点已经取消获取 |
| CONDITION（-2） | 节点在条件队列中等待 |
| PROPAGATE（-3） | 头节点记录共享释放需要继续传播 |

shouldParkAfterFailedAcquire 检查的是前驱状态。前驱为 SIGNAL 才允许当前节点停车；前驱已取消则沿 prev 跳过；其他状态先尝试改为 SIGNAL，并返回 false，让调用方重新检查能否获取。

```java
private static boolean shouldParkAfterFailedAcquire(Node pred, Node node) {
    int ws = pred.waitStatus;
    if (ws == Node.SIGNAL)
        return true;
    if (ws > 0) {
        do {
            node.prev = pred = pred.prev;
        } while (pred.waitStatus > 0);
        pred.next = node;
    } else {
        compareAndSetWaitStatus(pred, ws, Node.SIGNAL);
    }
    return false;
}
```

这次重新检查连接了“获取失败”与“准备停车”两个时刻：如果资源已经释放，线程可能直接获取；如果释放发生在真正 park 之前，unpark 提供的许可可以让 park 返回。park 仍可能中断或虚假返回，因此获取逻辑始终在循环中，不能靠一次唤醒证明条件满足。

可中断获取使用 acquireInterruptibly；它在入口和等待过程中检查中断并抛出 InterruptedException，finally 中通过 cancelAcquire 清理节点。带超时的 tryAcquireNanos 也可能取消。取消需要维护队尾或前后链接，并确保剩余等待者仍有通知路径，完整处理见固定版本源码，不能只把被取消节点的线程字段清空。

## 独占释放：唤醒的是竞争者，不是直接交出锁

release 先调用子类 tryRelease。可重入锁只减少了一部分计数时，应返回 false；完全释放后才检查 head 并尝试通知后继。

```java
public final boolean release(int arg) {
    if (tryRelease(arg)) {
        Node h = head;
        if (h != null && h.waitStatus != 0)
            unparkSuccessor(h);
        return true;
    }
    return false;
}
```

unparkSuccessor 尝试清除传入节点的负等待标记，再找未取消的后继。如果直接 next 不可用，就从 tail 沿 prev 回查；这与入队时先发布 prev、后连接 next 的顺序相配合。

```java
private void unparkSuccessor(Node node) {
    int ws = node.waitStatus;
    if (ws < 0)
        compareAndSetWaitStatus(node, ws, 0);
    Node s = node.next;
    if (s == null || s.waitStatus > 0) {
        s = null;
        for (Node t = tail; t != null && t != node; t = t.prev)
            if (t.waitStatus <= 0)
                s = t;
    }
    if (s != null)
        LockSupport.unpark(s.thread);
}
```

unpark 只是提供许可。被唤醒线程继续执行获取循环，可能再次失败；非公平同步器还允许其他线程在它之前获取。因此“FIFO 队列”“按队列选择唤醒对象”和“公平获取”不能混为一谈。

## 共享获取：一次成功之后还要决定是否传播

共享模式也先调用 tryAcquireShared，失败时才排队。成为 head 后继的线程再次获取，返回值非负才成功，然后调用 setHeadAndPropagate；返回值是获取结果，不必等于某种可数资源的剩余量。

```java
private void setHeadAndPropagate(Node node, int propagate) {
    Node h = head;
    setHead(node);
    if (propagate > 0 || h == null || h.waitStatus < 0 ||
        (h = head) == null || h.waitStatus < 0) {
        Node s = node.next;
        if (s == null || s.isShared())
            doReleaseShared();
    }
}
```

设置新 head 与检查传播条件可能和释放者交错。doReleaseShared 在 head 为 SIGNAL 时清标记并通知后继；head 为零时尝试标成 PROPAGATE。若操作期间 head 改变，就重新检查。PROPAGATE 的意义是保留继续通知的责任，不允许线程跳过子类的获取条件。

```java
private void doReleaseShared() {
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

[CountDownLatch](/countdown-latch/) 是一个具体例子：倒计数不为零时共享获取失败，降到零后成功，等待者可以继续向后传播通知。信号量则会消耗许可，不能照搬锁存器的 state 含义。

## 用公开 API 实现一个非重入互斥锁

下面的 state 只有 0、1 两种含义。获取时用 CAS 建立互斥，再记录拥有者；释放时必须检查当前线程，避免其他线程错误 unlock。条件等待还依赖 isHeldExclusively 的拥有者判断，不能仅判断“有人持锁”。

将两段代码分别保存为 Mutex.java 与 DemoApplication.java，执行：

```shell
javac -encoding UTF-8 -d out Mutex.java DemoApplication.java
java -cp out io.allurx.DemoApplication
```

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

实测输出为 300000，对应三个线程各完成 100000 次加锁自增。这个结果验证该用例中的互斥，不是对公平性、超时、取消和条件等待的穷尽证明。一般业务直接使用 ReentrantLock 等成熟同步器；自定义 AQS 子类应先明确 state、不变量、拥有者及失败路径。

## 资料来源

- [OpenJDK 8u202-b08 AQS：含入队、取消和超时的完整实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java)
- [Java SE 25 AQS：子类钩子与使用契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)
