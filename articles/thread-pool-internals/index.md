---
title: "ThreadPoolExecutor 原理"
date: 2020-01-08
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - ThreadPoolExecutor
  - ThreadPoolExecutor原理
domain: Java
---

一个任务执行完了，工作线程却没有退出，而是转身去队列里取下一个任务。线程复用就发生在这个循环中。不过线程池还必须处理另一类变化：新任务正在入队时，另一个线程可能已经发出关闭请求。

`ThreadPoolExecutor` 的实现围绕这两件事展开：让 Worker 持续工作，并在提交、创建和退出之间维护一致的状态。下面沿一项任务进入线程池到线程池终止的过程读源码。

本文按任务提交、Worker 执行、退出与关闭四条路径阅读 [OpenJDK 8u202-b08 完整源码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/ThreadPoolExecutor.java)。先读 [线程池参数与状态](/thread-pool-basics/) 和 [AQS 的独占模式](/aqs/)。下文摘录用于分析该版本的内部实现；可运行的接纳实验见[最大线程数与队列容量](/thread-pool-size/)。

## 状态与计数：ctl 是一次检查的快照

ctl 用 int 高 3 位保存运行状态，低 29 位保存 workerCount。RUNNING 接纳新任务；SHUTDOWN 拒绝新任务但处理队列；STOP 还停止取队列任务并请求中断工作线程；最后进入 TIDYING、TERMINATED。

workerCount 是已登记的工作线程计数，不是正在执行任务的精确数量，也不是不可变的“核心线程身份”。它可能与队列、运行状态同时变化，因此多阶段操作必须在关键边界重新读取 ctl。

## 新任务怎样进入线程池

提交者首先决定由新线程直接执行，还是放进队列。这个决定依赖刚才读到的状态，但检查结束后仍可能发生并发变化。

### execute 的接纳顺序

`addWorker(command, true)` 按核心数量限制尝试创建；入队失败后的 `addWorker(command, false)` 则使用最大数量限制。带着这一区别阅读入口：

```java
public void execute(Runnable command) {
    if (command == null)
        throw new NullPointerException();
    int c = ctl.get();
    if (workerCountOf(c) < corePoolSize) {
        if (addWorker(command, true))
            return;
        c = ctl.get();
    }
    if (isRunning(c) && workQueue.offer(command)) {
        int recheck = ctl.get();
        if (! isRunning(recheck) && remove(command))
            reject(command);
        else if (workerCountOf(recheck) == 0)
            addWorker(null, false);
    }
    else if (!addWorker(command, false))
        reject(command);
}
```

1. 数量小于 corePoolSize 时，尝试以当前任务作为 firstTask 创建 Worker。
2. 第一步未接纳时，池仍运行则尝试 offer。线程数等于 corePoolSize 已经走入队路径。
3. 不能入队时，尝试在 maximumPoolSize 限制内新增 Worker；失败则调用拒绝处理器。

无界队列通常始终可以接纳，第三步就很少触发，maximumPoolSize 因而不能替代队列容量限制。线程工厂返回 null、资源不足或并发关闭也可能使创建失败，不能把拒绝都解释成“线程已满”。

### 入队后为什么还要复查状态

线程 A 可以先看到 RUNNING，线程 B 随后 shutdown，A 再把任务加入队列。入队后重新读取状态，发现关闭时尝试 remove：成功移除才拒绝；若 Worker 已经取走任务，则不能再把它当作未接纳任务重复处理。

这说明提交与关闭重叠时任务可能已执行，不表示 shutdown 返回后才开始的新提交仍应接纳。任务进入队列后，还要处理工作线程数为零的情况：例如 corePoolSize 为零，或所有线程已空闲退出。addWorker(null, false) 尝试补充一个从队列取任务的 Worker。

### addWorker 先登记数量，再启动线程

第一阶段循环检查状态与容量，并 CAS 增加 workerCount。SHUTDOWN 只允许为已有排队任务增加 Worker：firstTask 必须为 null，且队列非空；STOP 及之后不允许新增。

第二阶段通过 ThreadFactory 构造实际线程，在 mainLock 下再次检查状态，把 Worker 加入集合后才启动线程。第一次检查成功与拿到主锁之间可能发生关闭，所以不能省略复查。

| 失败位置 | 必须恢复的状态 |
| --- | --- |
| 线程工厂返回 null 或构造失败 | 回退已经增加的 workerCount |
| 复查时池已不允许启动 | 不将任务强行交给新线程 |
| 已加入集合但启动失败 | 移除 Worker、回退计数，再检查是否可以终止 |

addWorkerFailed 把这些回退集中处理。它不把创建失败伪装成成功，也不保证每一种失败都能由拒绝策略消化；实际抛出的异常仍按调用路径传播。完整双循环和启动逻辑见固定源码。

## Worker 怎样复用一条线程

Worker 保存线程和任务相关状态。控制线程池的代码还需要知道它此刻是否空闲，才能决定是否中断等待。

### Worker 锁标记任务执行区间

Worker 同时实现 Runnable 和一个非重入 AQS 锁。它保存实际 thread、首次任务 firstTask 和完成计数。构造时 state 为 -1，阻止线程尚未开始正常工作时受到空闲中断；runWorker 入口解锁后才允许这种检查。

线程执行任务时持有 Worker 锁，取任务时不持有。shutdown 等控制操作通过 tryLock 识别可中断的空闲 Worker。锁必须非重入：如果任务自己调用 setCorePoolSize 等方法，可重入锁会让它重新获得自己的锁，误把正在工作的自身当作空闲线程。

### runWorker 不断执行下一个任务

循环里的 `task` 最初来自创建 Worker 时传入的任务，此后来自队列。`beforeExecute` 和 `afterExecute` 包围每次执行，而最外层 finally 处理整条 Worker 的退出。

```java
final void runWorker(Worker w) {
    Thread wt = Thread.currentThread();
    Runnable task = w.firstTask;
    w.firstTask = null;
    w.unlock(); // allow interrupts
    boolean completedAbruptly = true;
    try {
        while (task != null || (task = getTask()) != null) {
            w.lock();
            if ((runStateAtLeast(ctl.get(), STOP) ||
                 (Thread.interrupted() &&
                  runStateAtLeast(ctl.get(), STOP))) &&
                !wt.isInterrupted())
                wt.interrupt();
            try {
                beforeExecute(wt, task);
                Throwable thrown = null;
                try {
                    task.run();
                } catch (RuntimeException x) {
                    thrown = x; throw x;
                } catch (Error x) {
                    thrown = x; throw x;
                } catch (Throwable x) {
                    thrown = x; throw new Error(x);
                } finally {
                    afterExecute(task, thrown);
                }
            } finally {
                task = null;
                w.completedTasks++;
                w.unlock();
            }
        }
        completedAbruptly = false;
    } finally {
        processWorkerExit(w, completedAbruptly);
    }
}
```

循环先执行 firstTask，之后反复 getTask。每次任务前获取 Worker 锁，整理中断状态，再调用 beforeExecute、task.run、afterExecute；finally 清除局部任务引用、增加完成计数并释放 Worker 锁。

execute 提交的普通 Runnable 若把异常抛出任务体，Worker 可能异常退出；submit 常用的 FutureTask 会把任务异常记录到 Future 中，因此 task.run 可能正常返回。afterExecute 的 Throwable 参数不保证包含所有业务异常，需要结合具体任务类型解释，参见 [FutureTask](/future-task/)。

### getTask 决定等待还是退出

执行完一个任务后，Worker 进入 `getTask()`。返回非空值就继续工作，返回 null 则结束循环。下面的状态判断和超时判断都服务于这个选择：

```java
private Runnable getTask() {
    boolean timedOut = false; // Did the last poll() time out?
    for (;;) {
        int c = ctl.get();
        int rs = runStateOf(c);
        if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
            decrementWorkerCount();
            return null;
        }
        int wc = workerCountOf(c);
        boolean timed = allowCoreThreadTimeOut || wc > corePoolSize;
        if ((wc > maximumPoolSize || (timed && timedOut))
            && (wc > 1 || workQueue.isEmpty())) {
            if (compareAndDecrementWorkerCount(c))
                return null;
            continue;
        }
        try {
            Runnable r = timed ?
                workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) :
                workQueue.take();
            if (r != null)
                return r;
            timedOut = true;
        } catch (InterruptedException retry) {
            timedOut = false;
        }
    }
}
```

SHUTDOWN 且队列为空，或状态至少为 STOP 时，Worker 递减计数并退出。否则，allowCoreThreadTimeOut 为 true，或当前线程数超过 corePoolSize 时，使用带超时的 poll；其余情况使用 take。

超时、超过 maximumPoolSize 等条件可导致退出，但有待执行任务时要保留最后一个 Worker。线程没有固定的“核心/非核心”标记：同一线程在下一轮可能因为数量或配置改变而采用不同等待方式。

中断等待后，getTask 清除本次等待异常的影响并重新检查状态。它不是一看到中断就永久退出；shutdown 请求处理完队列，而 shutdownNow 的 STOP 才让后续取任务直接停止。

## Worker 退出与线程池关闭

一条 Worker 结束，并不意味着整个线程池结束。实现先移除这条线程，再结合剩余工作判断要补充线程还是推进终止。

### processWorkerExit 整理计数与集合

异常退出的路径尚未在 getTask 递减计数，因此这里先修正 workerCount；随后在主锁下累计完成数并移除 Worker，再尝试终止。

池处于 RUNNING 或 SHUTDOWN 时还可能需要补充线程。正常退出按允许超时、核心数量和队列是否为空计算最低需求；异常退出通常直接尝试补偿。真正的 addWorker 仍会检查最新状态，因此“调用补偿”不等于必然成功创建。

### 两种关闭方式如何影响队列

| 操作 | 新任务 | 排队任务 | 已开始任务 |
| --- | --- | --- | --- |
| shutdown | 拒绝 | 继续处理 | 继续执行，不主动中断业务任务 |
| shutdownNow | 拒绝 | 尝试移出并返回 | 尝试中断，是否停止取决于任务 |

shutdown 在主锁下进入 SHUTDOWN，通知空闲 Worker 重新检查状态，再尝试终止。已经在执行的 Worker 无法被空闲检查取得锁，因此不会收到这种空闲中断。

```java
public void shutdown() {
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        checkShutdownAccess();
        advanceRunState(SHUTDOWN);
        interruptIdleWorkers();
        onShutdown(); // hook for ScheduledThreadPoolExecutor
    } finally {
        mainLock.unlock();
    }
    tryTerminate();
}
```

shutdownNow 进入 STOP，向已开始的 Worker 请求中断，再排空队列。DelayedWorkQueue 等队列的 drainTo 可能只取当前可用元素，所以 drainQueue 还会扫描剩余任务并逐个移除。返回的列表是尚未执行的任务，不包含已经开始任务的进度快照。

### 最后一条 Worker 离开后发布终止状态

tryTerminate 在可能促成终止的动作后执行，例如 Worker 退出、启动失败回退、关闭期间移除任务。RUNNING 不能终止；SHUTDOWN 要求队列为空；存在 Worker 时先让空闲者继续检查退出。计数归零后，一个线程通过 CAS 进入 TIDYING，执行 terminated 钩子，再发布 TERMINATED 并通知 awaitTermination 的等待者。

awaitTermination 本身不关闭线程池，通常先 shutdown 或 shutdownNow，再等待。返回 true 表示已终止，false 表示等待预算耗尽；等待线程中断则抛异常。终止请求不能保证忽略中断的业务任务及时停止，因此应用仍需设计任务自己的取消和资源释放边界。

## 资料来源

- [OpenJDK 8u202-b08 ThreadPoolExecutor：完整实现与作者注释](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/ThreadPoolExecutor.java)
- [ThreadPoolExecutor：线程工厂、任务队列与钩子契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)
- [ExecutorService：关闭与等待终止](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html)
