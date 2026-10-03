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

线程 A 已经持有锁，线程 B 再来获取时应该怎么办？反复读取一个标记可以知道锁是否空闲，却还需要解决在哪里排队、何时休眠、谁负责唤醒，以及等待被中断后怎样退出。一把可用的锁，远不止一次 CAS。

AQS（`AbstractQueuedSynchronizer`）把这些等待过程集中起来，让子类只定义资源状态和获取、释放规则。换一种状态含义，它既能支撑互斥锁，也能支撑信号量和计数门闩。下面先沿 A 持锁、B 等待的过程读源码，再看共享模式与自定义锁怎样复用这套机制。

内部实现以 [OpenJDK 8u202-b08 源码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java)为准，需要先了解 [CAS](/cas/)、[线程中断](/thread-methods/)和 [LockSupport 的许可](/lock-support/)。末尾的互斥锁示例使用公开 API，目标环境为 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）；运行这个示例不会验证 Java 8 的内部队列布局。

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

### 首次尝试与队尾连接

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

### 入队后，何时有资格再次获取

线程 B 入队后仍有机会立即取得锁：如果 A 刚好已经释放，B 无需先休眠。`acquireQueued` 每轮先判断前驱是否为 `head`，只有成为头节点的后继时才尝试获取。成功后，B 的节点成为新 `head`；失败则进入准备等待的分支。

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

### 先让前驱承担通知责任，再准备休眠

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

这个顺序用来处理一个很窄却重要的窗口：B 发现锁被占用，正准备休眠，A 此时释放了锁。如果 B 没有建立通知关系，也没有重新检查，就可能把这次释放错过。先设置前驱的 `SIGNAL`，再回到循环尝试获取，把这两个阶段衔接起来；若通知发生在 `park` 之前，`unpark` 留下的许可也能让后续 `park` 返回。

`park` 还可能因中断或虚假唤醒而返回，所以 B 被唤醒后仍然回到获取循环。唤醒给它的是再试一次的机会，最终是否得到锁，仍由 `tryAcquire` 决定。

### 中断与超时怎样退出等待

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

假设 A 唤醒 B 后，新来的 C 抢先完成 `tryAcquire`。对允许插队的非公平同步器，这种顺序是合法的，B 需要继续等待。队列可以按顺序选出要通知的人，却不能单靠排队顺序保证谁先完成获取；公平策略还要落实到子类的获取判断中。

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

下载 [Mutex.java](./Mutex.java) 与 [DemoApplication.java](./DemoApplication.java)，放入同一目录后执行：

```shell
javac -encoding UTF-8 -d out Mutex.java DemoApplication.java
java -cp out io.allurx.DemoApplication
```

完整实现见 [Mutex.java](./Mutex.java)。它把 `Lock` 的公开方法委托给 AQS，并在三个钩子里定义锁的含义：

```java
@Override
protected boolean tryAcquire(int acquires) {
    if (compareAndSetState(0, 1)) {
        setExclusiveOwnerThread(Thread.currentThread());
        return true;
    }
    return false;
}

@Override
protected boolean tryRelease(int releases) {
    if (!isHeldExclusively()) {
        throw new IllegalMonitorStateException();
    }
    setExclusiveOwnerThread(null);
    setState(0);
    return true;
}
```

`isHeldExclusively()` 同时检查 `state == 1` 和拥有者是否为当前线程。获取失败后的排队、等待和取消都由 AQS 完成；这正是自定义代码与框架的分界。

运行入口见 [DemoApplication.java](./DemoApplication.java)：三个线程各执行 100000 次加锁自增，主线程等待它们结束后输出结果。锁包围的是读取、加一和写回这整个操作。

实测输出为 300000，对应三个线程各完成 100000 次加锁自增。这个结果验证该用例中的互斥，不是对公平性、超时、取消和条件等待的穷尽证明。一般业务直接使用 ReentrantLock 等成熟同步器；自定义 AQS 子类应先明确 state、不变量、拥有者及失败路径。

## 资料来源

- [OpenJDK 8u202-b08 AQS：含入队、取消和超时的完整实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java)
- [Java SE 25 AQS：子类钩子与使用契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)
