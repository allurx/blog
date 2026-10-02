---
title: ThreadPoolExecutor原理
date: 2020-01-08
tags:
  - Java
  - Concurrent
  - ThreadPoolExecutor
  - ThreadPoolExecutor原理
domain: Java
---

## 核心结论

线程池复用的是不断获取任务的工作线程，任务只占据它生命周期中的一段。`execute()`、入队后的状态复查、`addWorker()` 和退出补偿共同维护任务接纳与关闭的边界；只看“核心、队列、最大”三个分支不足以解释并发关闭时的行为。

## 问题与适用范围

本文回答任务从提交到工作线程执行、空闲、退出的完整链路，保留原文 `Worker`、`ctl` 与 AQS 旧源码，未标注精确 JDK 修订。公共使用应依赖 `ThreadPoolExecutor` 契约；内部状态、位布局和方法名称属于实现细节，不能直接用来跨版本控制线程池。

<!-- more -->

## execute方法

execute方法是线程池提交任务的入口，执行该方法后线程池将会基于已配置的各个参数来选择线程池中已存在的线程或者新建线程来执行这个任务，如果此时线程池已经关闭或者线程池中的线程数已到达maximumPoolSize并且任务队列已满的情况下将会通过参数RejectedExecutionHandler来处理这个任务。

```java
public void execute(Runnable command) {
    if (command == null)
        throw new NullPointerException();
    int c = ctl.get();
    // 第一步，少于核心线程数则创建新线程
    if (workerCountOf(c) < corePoolSize) {
        if (addWorker(command, true))
            return;
        c = ctl.get();
    }
    // 第二步，超过核心线程数则将该任务提交到阻塞队列
    if (isRunning(c) && workQueue.offer(command)) {
        int recheck = ctl.get();
        if (! isRunning(recheck) && remove(command))
            reject(command);
        else if (workerCountOf(recheck) == 0)
            addWorker(null, false);
    }
    // 第三步，阻塞队列满了则尝试新建线程，返回false代表
    // 线程池线程数超过maximumPoolSize或者线程池已经关闭了
    else if (!addWorker(command, false))
        reject(command);
}
```

整个execute方法的执行步骤一共分为三个步骤

1. 如果线程池中的线程数少于corePoolSize，则尝试通过addWorker方法来新建一个线程执行提交的任务。 在执行addWorker方法时会原子地检查runState和workerCount，通过返回false来防止在不应该添加线程的情况下发出错误警报。因为存在多个线程并发的提交任务，所以需要在addWorker内部确保正确的创建线程。
2. 如果线程池中的线程数超过corePoolSize则尝试将该任务提交到阻塞队列。
3. 如果无法将任务添加到阻塞队列，则尝试新建线程处理这个任务，如果addWorker方法返回false则代表线程池已经饱和或者线程池已经关闭了，然后拒绝该任务。

下面我们就基于以上三步对于execute方法进行深入的研究

### 线程池中线程数小于核心线程数

```java
if (workerCountOf(c) < corePoolSize) {
    if (addWorker(command, true))
        return;
    c = ctl.get();
}
```

提交任务时如果此刻线程池中的线程数少于核心线程数，则尝试新建线程来处理这个任务，关键点在于这个addWorker方法是如何新建线程的

#### addWorker方法

addWorker方法的目的是为了新建一个线程来处理这个提交的任务，由于并发的原因可能存在多个线程同时调用addWorker方法尝试新建线程，因此必须原子的检查是否应该创建线程。addWorker方法执行逻辑可以分成两步

1. 检查是否应该创建一个新的线程来处理这个任务
2. 在满足第一步的条件下创建新的线程，然后执行提交的任务

##### 检查是否应该创建线程

```java
retry:
for (;;) {
    int c = ctl.get();
    int rs = runStateOf(c);

    // Check if queue empty only if necessary.
    if (rs >= SHUTDOWN &&
        ! (rs == SHUTDOWN &&
           firstTask == null &&
           ! workQueue.isEmpty()))
        return false;

    for (;;) {
        int wc = workerCountOf(c);
        if (wc >= CAPACITY ||
            wc >= (core ? corePoolSize : maximumPoolSize))
            return false;
        if (compareAndIncrementWorkerCount(c))
            break retry;
        c = ctl.get();  // Re-read ctl
        if (runStateOf(c) != rs)
            continue retry;
        // else CAS failed due to workerCount change; retry inner loop
    }
}
```

使用了嵌套自旋来进行判断，外层自旋判断当前线程池状态

```java
if (rs >= SHUTDOWN && ! (rs == SHUTDOWN && firstTask == null && ! workQueue.isEmpty())) return false
```

这个判断有点复杂，首先我们需要明白整个addWorker方法返回false代表线程池已经被关闭了（其它线程调用了shutdown方法）或者线程池已经饱和了（线程池中的线程数量达到maximumPoolSize），所以要使addWorker方法能够新建线程也就相当于使表达式`rs == SHUTDOWN && firstTask == null && ! workQueue.isEmpty()) == true`成立，这样这个if就不会返回false了，这个表达式成立的含义为：**当前线程池已经被关闭了并且此刻提交的任务是null并且此刻还存在未处理完的任务**。那么就可以新建线程来帮助处理那些还没有完成的任务。外层自旋判断通过后截止执行内层自旋判断当前线程池中的数量是否合理，根据addWorker方法传入的参数`boolean core`来选择与核心线程池数量还是与最大线程数量作比较：

```java
int wc = workerCountOf(c);
if (wc >= CAPACITY ||
    wc >= (core ? corePoolSize : maximumPoolSize))
    return false;
```

只要此刻线程池中的线程数超过容量或者超过了核心线程数或者是超过了最大阈值则返回false，不允许创建线程。否则的话通过cas尝试增加当前线程池中的worker数量。如果成功则跳出整个retry，如果失败的话，那么有可能是其它线程也执行到这里了（compareAndIncrementWorkerCount方法只会在addWorker方法中被执行），这个时候需要重将线程池状态与外层自旋时的状态作对比，因为导致cas失败的其它线程可能会修改线程池的状态，如果状态不一致的话代表此刻其它线程改变了线程池的状态，这个时候就需要重新从外层自旋开始进行判断了，线程池这个时候很有可能已经被关闭了。
	能够成功跳出两层自旋代表此刻是有资格新建线程的，接下来就开始尝试新建线程了

##### 创建新的线程

走到下面这段代码代表是有资格创建线程的，不过还是需要进行原子检查，此刻还是存在并发的。

```java
boolean workerStarted = false;
boolean workerAdded = false;
Worker w = null;
try {
    w = new Worker(firstTask);
    final Thread t = w.thread;
    if (t != null) {
        final ReentrantLock mainLock = this.mainLock;
        mainLock.lock();
        try {
            // Recheck while holding lock.
            // Back out on ThreadFactory failure or if
            // shut down before lock acquired.
            int rs = runStateOf(ctl.get());

            if (rs < SHUTDOWN ||
                (rs == SHUTDOWN && firstTask == null)) {
                if (t.isAlive())
                    throw new IllegalThreadStateException();
                workers.add(w);
                int s = workers.size();
                if (s > largestPoolSize)
                    largestPoolSize = s;
                workerAdded = true;
            }
        } finally {
            mainLock.unlock();
        }
        if (workerAdded) {
            t.start();
            workerStarted = true;
        }
    }
} finally {
    if (! workerStarted)
        addWorkerFailed(w);
}
return workerStarted;
```

首先提交的任务构造成一个Worker，这个Worker就是整个线程池中核心运行的任务，下面会详细介绍它。然后通过ReentrantLock这把独占锁锁住下面添加workers的方法，由于在调用shutdown方法或者shutdownNow方法时也会先获取锁，但是不能保证执行addWorker方法的线程先获得这把锁，所以添加workers前需要先判断当前线程池的状态

```java
if (rs < SHUTDOWN ||(rs == SHUTDOWN && firstTask == null)) {
    ......
}
```

只要当前线程池处于运行状态（小于SHUTDOWN就是处于运行状态）或者虽然已经处于SHUTDOWN状态了，但是提交的任务为null，这种情况只会出现在调用了addWorker方法但传入的command为null，其中一种情况可能是某个worker在执行这个任务的时候抛出异常了，也就是runWorker方法（后面会详细分析这个方法，现在只需要知道就行）里面的completedAbruptly==true，这个时候就会传递一个空任务来替代这个worker。所以只有满足以上两个条件下添加worker才是正确的。

```java
if (t.isAlive())
    throw new IllegalThreadStateException();
```

因为worker的线程是通过ThreadFactory创建的，而调用线程的start方法先决条件是线程必须是未启动的（没有调用过start方法），所以如果ThreadFactory返回的是一个已启动的线程就需要抛出异常。

紧接着执行一系列的将worker添加到所有的worker集里面以及记录线程池达到过的最大尺寸然后标记worker已被添加。

```java
if (workerAdded) {
    t.start();
    workerStarted = true;
}
```

只要worker成功被添加到worker集中就调用start方法启动这个线程。然后在finally块中清除那些未能启动的线程。

```java
} finally {
    if (! workerStarted)
        addWorkerFailed(w);
}
```

addWorkerFailed方法主要是用来将这个未启动成功的worker从worker集中清除以及重新调整当前线程池中的线程数。

###### 清理未能成功启动的线程

```java
private void addWorkerFailed(Worker w) {
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        if (w != null)
            workers.remove(w);
        decrementWorkerCount();
        tryTerminate();
    } finally {
        mainLock.unlock();
    }
}
```

addWorkerFailed的执行逻辑很简单，从worker集中移除这个worker，递减当前线程池中的线程数，然后尝试终止线程池。至于**为什么要尝试终止线程池是因为我们不能保证这个启动失败的线程是因为什么原因启动失败的，甚至可能这个未能启动成功的线程运行时执行了shutdown或者shutdownNow方法，所以很有必要去检查尝试终止线程池。**后面会详细分析tryTerminate方法。

##### addWorker方法总结

addWorker方法在添加Worker时首先需要检查当前线程池的状态是否正常以及当前线程池中的线程数是否合理，如果添加的是核心线程则当前线程池中的数量不允许超过corePoolSize，否则则不允许超过maximumPoolSize，当然了也不能超过线程池预设的容量CAPACITY。在满足以上条件后接下来新建worker时可能存在其它线程调用shutdown或者shutdownNow方法，所以需要再次判断线程池状态是否正确。同时由于存放worker的是一个非线程安全的HashSet，因此需要通过独占锁来保证线程安全。接下来如果不能成功启动线程则需要回退清除掉这个worker。

在addWorker方法分析完之后，里面还剩下一个点没有分析就是核心部分的Worker是如何执行任务以及线程池是如何复用worker的，接下来我们就来看一下Worker的实现原理。

#### Worker

我们先来看一下worker的结构

```java
private final class Worker
    extends AbstractQueuedSynchronizer
    implements Runnable
{
    private static final long serialVersionUID = 6138294804551838833L;

    // worker运行的线程，由ThreadFactory提供
    final Thread thread;
    // 提交的任务
    Runnable firstTask;
    // 每个worker总共完成的任务
    volatile long completedTasks;

    Worker(Runnable firstTask) {
        setState(-1);
        this.firstTask = firstTask;
        this.thread = getThreadFactory().newThread(this);
    }

    // 实际上最终是通过ThreadPoolExecutor的runWorker运行的
    public void run() {
        runWorker(this);
    }


	// 继承AQS实现的方法
    protected boolean isHeldExclusively() {
        return getState() != 0;
    }

    protected boolean tryAcquire(int unused) {
        if (compareAndSetState(0, 1)) {
            setExclusiveOwnerThread(Thread.currentThread());
            return true;
        }
        return false;
    }

    protected boolean tryRelease(int unused) {
        setExclusiveOwnerThread(null);
        setState(0);
        return true;
    }

    public void lock()        { acquire(1); }
    public boolean tryLock()  { return tryAcquire(1); }
    public void unlock()      { release(1); }
    public boolean isLocked() { return isHeldExclusively(); }

    void interruptIfStarted() {
        Thread t;
        if (getState() >= 0 && (t = thread) != null && !t.isInterrupted()) {
            try {
                t.interrupt();
            } catch (SecurityException ignore) {
            }
        }
    }
}
```

整个Worker的结构如上所示，实现了Runnable代表它是一个能够被Thread执行的任务，这里有一个很奇怪的地方，Worker为什么需要继承AbstractQueuedSynchronizer？这里先卖一个关子，在下面分析时我会解释原因。同时我们可以看到run方法的执行逻辑

```java
public void run() {
    runWorker(this);
}
```

也就是说在worker运行任务时实际上调用的就是ThreadPoolExecutor的runWorker方法，入参时worker自身，我们接着看这个runWorker方法的执行逻辑是什么

##### runWorker方法

```java
final void runWorker(Worker w) {
    // 拿到当前执行任务的线程，也就是Worker对象中的那个Thread
    Thread wt = Thread.currentThread();
    // worker持有的任务
    Runnable task = w.firstTask;
    // 帮助GC回收
    w.firstTask = null;
    // Worker继承了AQS，所以执行unlock实际上最终
    // 执行的就是Worker的tryRelease的方法，而
    // tryRelease始终返回true，方法内部仅仅时将AQS的state设置为0，
    // 代表此刻线程才真正开始运行任务，
    // 也就是说执行到这一行代码前都是不允许中断当前线程的，
    // 注意这段代码执行完毕后AQS的state为0
    w.unlock();
    // 是否在执行钩子方法或者执行提交的任务时发生异常的标记
    boolean completedAbruptly = true;
    try {
        // 这个while循环就是整个执行流程的关键之处，如果worker时持有任务
        // 或者从当前线程池的任务队列中能够拿到任务的话则开始执行任务，需要注意的是
        // 这个getTask方法内部是通过Queue的take方法取任务的，这就是线程池线程能够
        // 重用线程的原因
        while (task != null || (task = getTask()) != null) {
            // 此时AQS的state为1
            w.lock();
            // 只有以下两种情况需要中断当前线程
            // 1、已经执行shutdownNow方法但还未中断当前worker线程
            // （shutdownNow方法中断当前线程的操作可能晚于任务执行）
            // 所以需要执行wt.interrupt()方法恢复该worker的线程的中断标记
            // 2、已经执行shutdownNow方法并且shutdownNow方法也成功中断了这个
            // worker的线程，由于Thread.interrupted()会重置线程的中断状态，
            // 所以需要执行wt.interrupt()方法恢复该worker的线程的中断标记
            if ((runStateAtLeast(ctl.get(), STOP) ||
                 (Thread.interrupted() &&
                  runStateAtLeast(ctl.get(), STOP))) &&
                !wt.isInterrupted())
                wt.interrupt();
            try {
                // 执行前钩子函数
                beforeExecute(wt, task);
                Throwable thrown = null;
                try {
                    // 运行任务
                    task.run();
                } catch (RuntimeException x) {
                    thrown = x; throw x;
                } catch (Error x) {
                    thrown = x; throw x;
                } catch (Throwable x) {
                    thrown = x; throw new Error(x);
                } finally {
                    // 执行后钩子函数
                    afterExecute(task, thrown);
                }
            } finally {
                task = null;
                w.completedTasks++;
                w.unlock();
            }
        }
        // 能够执行这一步说明执行这某一次任务过程中没有发生异常
        completedAbruptly = false;
    } finally {
        // 发生异常或者队列中没有任务时
        processWorkerExit(w, completedAbruptly);
    }
}
```

在上面worker类结构分析时我们提到了worker为什么要继承AQS？一开始我也不是很理解，后来我在worker类的注释上看到了作者对于worker类扩展AQS的目的

```java
This protects against interrupts that are intended to wake up a worker thread waiting for a task from instead interrupting a task being run.
```

**这段话的意思是继承AQS可以方便的唤醒那些因为拿不到任务而阻塞的线程从而避免直接中断当前正在运行的线程。**因为当前正在运行的线程执行的任务中可能会调用像`Thread.sleep`这样的方法，如果直接设置worker线程为中断的话就会抛出InterruptedException了，而worker线程在通过getTask方法拿任务时，内部是通过Queue的take和带超时的poll方法来获取任务的，所以如果队列为空的话就会阻塞，而大部分队列take和poll方法底层都是通过`LockSupport.park`这个方法来阻塞线程的，所以这个时候将worker线程中断的话被LockSupport阻塞的线程就能够继续运行了，（不理解LockSupport阻塞唤醒机制的可以看我之前写的相关文章）这样就避免了一些意外的情况发生。其实在shutdown方法内部线程池就会去中断那些**空闲的线程**，这个空闲的定义就是通过worker的tryLock方法来判断当前worker线程是否已经执行过lock方法

```java
while (task != null || (task = getTask()) != null) {
	w.lock();
    ......
}
```

上面的while循环拿到任务的第一时刻就是上锁，上了锁就代表这个线程**不是空闲的**，所以我认为worker继承AQS的原因是为了方便控制唤醒worker线程，当然了这只是我个人的理解，不一定准确。其实在早期版本的ThreadPoolExecutor实现中worker并没有继承AQS，而是拥有一个ReentrantLock成员变量，ReentrantLock本身也是基于AQS实现的，后来改成继承AQS的原因作者解释为

```java
We implement a simple non-reentrant mutual exclusion lock rather than use ReentrantLock because we do not want worker tasks to be able to reacquire the lock when they invoke pool control methods like setCorePoolSize.
```

当调控制线程池相关的方法时诸如setCorePoolSize方法时worker需要获取ReentrantLock，可能时处于性能的考虑最终将worker自己当做一把独占锁来使用。

下面我们接着分析getTask方法，看看当前线程时如何获取任务的

###### getTask方法

```java
private Runnable getTask() {
    // 这个worker在上一次for循环时被当做非核心线程执行poll
    // 方法时是否在指定的时间内从队列中获取到任务，
    // 注意每个worker每次执行这个getTask方法是既可能时核心线程
    // 也可能时非核心线程，取决于此刻的workerCountOf(c)与allowCoreThreadTimeOut
    boolean timedOut = false;

    for (;;) {
        int c = ctl.get();
        int rs = runStateOf(c);

        // 在从队列中获取任务前如果满足以下两种情况则不需要获取任务了
        // 1、其它线程调用了shutdownNow方法
        // 2、其它线程调用了shutdown方法并且线程池中已经没有任务了
        if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
            decrementWorkerCount();
            return null;
        }

        int wc = workerCountOf(c);

        // 当前这个worker线程是否需要被淘汰的标记，
        // 1、如果允许核心线程超时代表线程池中的所有线程都会在空闲
        // 指定的时间内被淘汰
        // 2、不允许核心线程超时并且当前线程池中线程数超过核心线程数了代表当前
        // 这个worker线程不是核心线程，那就肯定会在指定的超时时间内被淘汰
        boolean timed = allowCoreThreadTimeOut || wc > corePoolSize;

        // 分四种情况，比较复杂，下面再分析
        if ((wc > maximumPoolSize || (timed && timedOut))
            && (wc > 1 || workQueue.isEmpty())) {
            if (compareAndDecrementWorkerCount(c))
                return null;
            continue;
        }

        // 走到这里代表当前这个worker线程需要从队列中获取任务
        try {
            // timed代表当前这个worker是否需要在空闲指定的时间内被淘汰，true的
            // 话则调用Queue的带超时的poll方法阻塞当前线程直到经过直到的时间。
            // false的话则代表当前worker线程时核心线程，是不需要超时的，那就调用take方法
            // 阻塞直到能够从队列中获取任务为止
            Runnable r = timed ?
                workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) :
            workQueue.take();
            // 注意take方法时肯定不会返回null的，这是Queue的特性，所以返回只要返回null就代表
            // 当前这个worker线程肯定是非核心线程并且超时了。那么下一次for循环极大概率是需要淘汰这个
            // 非核心线程的
            if (r != null)
                return r;
            // 代表这个worker线程是一个非核心超时的线程
            timedOut = true;
            // 如果当前worker线程在阻塞期间抛出InterruptedException
            // 仅仅忽略这次异常，执行下一次for循环重试获取任务
        } catch (InterruptedException retry) {
            timedOut = false;
        }
    }
}
```

整个getTask方法的执行逻辑比较简单，唯一有点奇怪的地方在于下面这段代码处

```java
if ((wc > maximumPoolSize || (timed && timedOut))
    && (wc > 1 || workQueue.isEmpty())) {
    if (compareAndDecrementWorkerCount(c))
        return null;
    continue;
}
```

这个if判断比较复杂，在满足这个if条件的情况下可以拆分成以下四种情况

1. `wc > maximumPoolSize && wc > 1 == true`

   并发情况下其它线程调用了setMaximumPoolSize方法动态的减少了maximumPoolSize导致当前线程池中的线程数超过了调整后的maximumPoolSize并且当前线程池中还存在其它线程（wc > 1）。这个时候当前这个worker线程相当于溢出了，则尝试cas减少当前线程池的worker数量，如果成功的话则返回null那么这个worker线程就会跳出runWorker的while循环，也就执行结束了，如果cas失败说明此刻有其它线程在修改线程池中的线程数，那么则重新执行for循环，因为可能下次for循环说不定当前线程池的线程数就没有超过maximumPoolSize了

2. `wc > maximumPoolSize && workQueue.isEmpty() == true`

   与第一个条件相呼应，同样动态减少了maximumPoolSize，只不过减少到当前线程池maximumPoolSize==1了，（ps：setMaximumPoolSize方法中重设的maximumPoolSize规定必须>0），也就是说此刻线程池时一个固定的只有一个线程的线程池，那么就需要判断任务队列中的任务是不是都已经执行完毕了，只要都执行完毕了那么就可以尝试将这最后一个线程也淘汰掉了。

3. `(timed && timedOut) && wc > 1 == true`

   `timed && timedOut == true`代表当前线程是一个需要被淘汰的超时的非核心线程，并且只要当前线程池中还有其它线程存活的话（如果没有其它线程存活的话就不能淘汰，万一还有任务没执行完毕呢？）那就尝试将这个线程淘汰。

4. `(timed && timedOut) && workQueue.isEmpty() == true`

   与第三个条件相呼应，如果当前队列中的任务都执行完毕了并且当前这个线程是线程池中最后一个超时的非核心线程的话，那就尝试淘汰这个线程。

getTask方法返回null的话就代表当前这个worker线程需要被淘汰了，那么接下来就会跳出runWorker方法中的while循环，执行finally块中的processWorkerExit退出方法

###### processWorkerExit方法

```java
private void processWorkerExit(Worker w, boolean completedAbruptly) {
    // 如果时发生异常被淘汰的则递减当前worker的数量
    if (completedAbruptly)
        decrementWorkerCount();

    // 记录这个worker总共完成的任务然后从worker集中删除这个worker
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        completedTaskCount += w.completedTasks;
        workers.remove(w);
    } finally {
        mainLock.unlock();
    }

    tryTerminate();

    // 不明白为什么要在STOP状态下进行下面的判断
    int c = ctl.get();
    if (runStateLessThan(c, STOP)) {
        if (!completedAbruptly) {
            int min = allowCoreThreadTimeOut ? 0 : corePoolSize;
            if (min == 0 && ! workQueue.isEmpty())
                min = 1;
            if (workerCountOf(c) >= min)
                return; // replacement not needed
        }
        addWorker(null, false);
    }
}
```

processWorkerExit方法是在worker线程拿不到任务时或者执行任务过程中发生异常时无论如何都会执行的方法，整个流程的前半部分比较简单，最后部分

```java
// 当前线程池处于RUNNING或者SHUTDOWN状态
if (runStateLessThan(c, STOP)) {
    // 如果不是发生异常被淘汰的
    if (!completedAbruptly) {
        // 线程池中允许存活的最小线程数
        int min = allowCoreThreadTimeOut ? 0 : corePoolSize;
        // 如果所有线程都允许超时并且此刻任务队列不为空则代表至少需要一个线程来执行剩余的所有任务
        if (min == 0 && ! workQueue.isEmpty())
            min = 1;
        // 如果此刻线程池中的线程数满足上面那个min值的话代表不需要额外创建新的worker来处理剩余的任务
        if (workerCountOf(c) >= min)
            return; // replacement not needed
    }
    // 如果时执行任务过程中发生异常而被淘汰的话则补偿一个worker线程
    addWorker(null, false);
}
```

目前只能整理出worker线程退出前并且线程池处于RUNNING或者SHUTDOWN这两种情况下何时会添加一个补偿worker，至于原因目前我不得而知：

1. worker线程是由于执行任务发生异常而被淘汰的话会新增一个worker进行补偿
2. worker线程不是由于执行任务发生异常而是正常情况下退出的，但是此刻线程池中的线程数达不到线程池允许存活的最小线程数的话会新增一个worker进行补偿

有关worker执行任务的流程主体部分已经分析完了，现在还有一个被忽略的点，我们发现在与processWorkerExit与addWorkerFailed这两个方法中将worker从worker集中移除后都执行了一个tryTerminate方法，这是什么原因呢？我们先来看一下tryTerminate方法都做了什么。

###### tryTerminate方法

```java
final void tryTerminate() {
    for (;;) {
        int c = ctl.get();
        // 如果当前线程池状态处于运行状态或者线程池至少已经处于
        // TIDYING状态了（代表已经被终止了）或者线程池处于
        // SHUTDOWN状态（调用了shuntdown方法）但是任务还没有处理完的话
        // 这些情况下时还不需要终止线程池
        if (isRunning(c) ||
            runStateAtLeast(c, TIDYING) ||
            (runStateOf(c) == SHUTDOWN && ! workQueue.isEmpty()))
            return;
        // 不是以上三种情况代表目前为止是有资格终止线程池的，
        // 如果此刻线程池中的线程数超过0个的话，则尝试终止一个空闲的线程，
        // interruptIdleWorkers会将第一个阻塞的线程唤醒，接下来这个线程就会跳出runWorker
        // 方法中的while循环最后执行processWorkerExit方法，则processWorkerExit方法会继续
        // 调用tryTerminate方法来确保传递终止信号
        if (workerCountOf(c) != 0) {
            interruptIdleWorkers(ONLY_ONE);
            return;
        }

        // 执行到这里代表线程池中的状态必定是处于SHUTDOWN或者STOP状态之一
        final ReentrantLock mainLock = this.mainLock;
        mainLock.lock();
        try {
            // cas尝试将当前线程池状态设置为TIDYING将线程池中的线程数设置为0，
            // 成功的话则调用钩子方法terminated，因为存在并发调用tryTerminate方法
            // 所以只需要确保一个线程调用成功即可
            if (ctl.compareAndSet(c, ctlOf(TIDYING, 0))) {
                try {
                    terminated();
                } finally {
                    // 最终将线程池状态设置为TERMINATED将线程池中的线程数设置为0
                    ctl.set(ctlOf(TERMINATED, 0));
                    // 线程池成功被终止后唤醒那些调用awaitTermination方法等待线程池终止的线程
                    termination.signalAll();
                }
                return;
            }
        } finally {
            mainLock.unlock();
        }
        // else retry on failed CAS
    }
}
```

在上面分析中我们只是分析了tryTerminate方法中断线程池的流程，tryTerminate方法只会在以下两种情况下尝试中断当前线程池

1. 调用了shutdown方法之后并且线程池中的任务都被执行完成之后
2. 调用了shutdownNow方法之后

但是为什么需要在processWorkerExit与addWorkerFailed中调用这个tryTerminate方法呢？作者在这个方法的注释如下

```java
This method must be called following any action that might make termination possible -- reducing worker count or removing tasks from the queue during shutdown.
```

tryTerminate方法必须在任何可能导致终止的操作中之后被调用，例如减少线程池的worker数量或者当关闭线程池从队列中移除任务的时候。举一个例子：现在我们通过execute方法提交了一个新任务并且线程池中的线程数还未达到corePoolSize，因此会执行addWorker方法最终新建一个worker最后线程会执行runWorker方法，假设这个worker的线程名为A，现在A执行到了runWorker中的这一行代码处

```java
final void runWorker(Worker w) {
    Thread wt = Thread.currentThread();
    Runnable task = w.firstTask;
    w.firstTask = null; // 执行到这一行
    w.unlock();
    .....省略相关代码
}
```

执行到我上面注释的那一行，还记得worker的 构造函数吗？**初始化设置AQS的state为-1**，假设此刻CPU调度使A线程暂停执行，紧接着此刻另一个B线程执行了shutdown方法关闭线程池，在shutdown方法中最终会调用interruptIdleWorkers(false)来中断worker集中所有的空闲的线程，回想我们上面分析runWorker方法中有关**空闲**的定义

```java
if (!t.isInterrupted() && w.tryLock()) {
    ......
}
```

只要tryLock方法返回true则代表这个worker线程时空闲的，而tryLock调用的是worker的tryAcquire方法

```java
protected boolean tryAcquire(int unused) {
    if (compareAndSetState(0, 1)) {
        setExclusiveOwnerThread(Thread.currentThread());
        return true;
    }
    return false;
}
```

也就是说只要此刻worker的状态时0则代表是空闲的，但是对于上面的A线程来说它的state时-1所以A线程不是空闲的，所以就会存在B线程将那些的确**空闲**的线程都唤醒之后遗漏了A线程的情况，因此所有线程在退出前都会执行processWorkerExit方法然后在内部继续调用tryTerminate方法确保将线程池内的所有线程都中断（唤醒）。

以上所有的分析都是针对于执行addWorker方法时当前线程池中的线程数不超过corePoolSize的情况，现在我们将思绪回到addWorker中的第二中情况中来

### 线程池正在运行并且核心线程数已满但任务队列未满

对应于addWorker方法中的代码如下

```java
if (isRunning(c) && workQueue.offer(command)) {
    int recheck = ctl.get();
    if (! isRunning(recheck) && remove(command))
        reject(command);
    else if (workerCountOf(recheck) == 0)
        addWorker(null, false);
}
```

#### 任务入队前或者任务入队后线程池被其它线程关闭

如果满足`isRunning(c) && workQueue.offer(command) == true`至少表明在执行`workQueue.offer(command)`这段代码前线程池时在运行的，但不能保证在执行`workQueue.offer(command)`这段代码时线程池被其它线程关闭了，所以这个if为true是有可能发生以下两种情况的：

1. 核心线程已满任务成功排队后线程池依旧正在运行
2. 核心线程已满任务成功排队前线程池就被关闭了

在上面第二种情况下这个任务就相当于被错误的提交到线程池了，违反了关闭状态下的线程池不允许提交任务这个规则。因此需要进行二次判断这个任务是否需要被回滚

```java
if (! isRunning(recheck) && remove(command))
    reject(command);
```

如果`! isRunning(recheck) == true`成立代表自进入外层的if以来有其它线程关闭了线程池。对应以下两种情况：

1. 外层if执行完成后至执行`! isRunning(recheck)`这段代码这段极短的时间内线程池被其它线程关闭了
2. 执行外层if的`workQueue.offer(command)`这段代码对任务排队期间线程池被其它线程关闭了

因此在这种并发情况下需要**尝试**对这个任务进行回滚，注意：是尝试回滚，不一定能够回滚成功。回滚调用的是内部的remove方法

##### remove方法

```java
public boolean remove(Runnable task) {
    boolean removed = workQueue.remove(task);
    tryTerminate();
    return removed;
}
```

可以看到内部调用的时队列的remove方法尝试将这个任务从队列中移除，因为不能保证这个任务一定能够被成功移除。考虑以下这种情况：A线程执行execute时发现此刻线程池的核心线程满了，然后就会执行`if (isRunning(c) && workQueue.offer(command))`这段代码尝试将这个任务进行排队，但是在任务还没有成功入队前CPU进行调度A线程被挂起此时另一个B线程调用了shutdown方法关闭了线程池将线程池的状态设置为SHUTDOWN，紧接着CPU进行调度，B线程被挂起A线程成功将任务入队，接着CPU继续调度A线程被挂起B线程接着运行shutdown方法唤醒了线程池中那些空闲的线程然后这些空闲的线程从队列中取出了刚刚A线程刚刚提交的任务开始执行，恰巧此刻CPU又继续调度B线程被挂起，A线程继续执行内层的`if (! isRunning(recheck) && remove(command))`判断，发现线程池被关闭了（B线程关闭的）并且尝试调用remove方法失败，因为刚刚B线程shutdown后唤醒的线程将A线程提交的任务take出来了，这样就相当于**被提交的任务由于其它线程关闭了线程池导致这个任务被错误的执行了，导致这个任务并没有被回滚**，所以我在开头说只是**尝试对任务进行回滚**。网上很多文章都是错误的，**shutdown状态下的线程池也是有可能存在提交并成功执行任务的**。

所以在上面的remove尝试中如果能够成功删掉刚刚提交的这个任务，说明还是有补救的余地的，就通过reject方法来拒绝这个被错误提交的任务。当然啦拒绝任务就是通过构造线程池时指定的RejectedExecutionHandler来拒绝这个任务的

##### reject方法

```java
final void reject(Runnable command) {
    handler.rejectedExecution(command, this);
}
```

#### 任务回滚失败或者任务入队前后线程池都处于运行状态

```java
else if (workerCountOf(recheck) == 0)
    addWorker(null, false);
```

如果能够执行这个else if判断代表此刻必定时以下两种情况之一

1. 任务回滚失败
2. 任务入队前后线程池都处于运行状态

但是在以上两种情况下为什么还需要判断当前线程池的线程数是否为0呢？考虑以下这种情况：假设此刻线程池处于运行状态并且核心线程已满任务队列未满，A线程执行execute方法提交了一个任务T并成功入队，但是此刻线程池中的所有核心线程都正在执行耗时的任务，所以此刻任务队列中只存在一个任务T，紧接着CPU进行调度A线程被挂起。另一个B线程调用了shutdownNow方法将线程池的状态变更为STOP然后内部会调用interruptWorkers方法将所有的的核心线程的中断标记设置为true（**注意当线程的中断标记设置为true之后基于LockSupport来阻塞线程的同步类，例如BlockingQueue，AQS等在执行那些阻塞方法时就不会使当前线程阻塞或者直接抛出InterruptedException**）紧接着CPU调度B线程与A线程同时被挂起（还未执行shutdownNow方法中的drainQueue方法），此时线程池中的所有核心线程刚刚将那些耗时的任务都执行完毕，接着runWorker方法中的while循环就会继续执行getTask方法去队列中拿任务

```java
private Runnable getTask() {
    ......省略部分代码
        if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
            decrementWorkerCount();
            return null;
        }
   ......省略部分代码
}
```

注意这个if判断，因为上面B线程调用shutdownNow方法将线程池的状态设置为STOP了，所以接下来所有的核心线程都无法从队列中获取到任务，然后就会跳出runWorker的while循环，最终所有的核心线程将全部被移除，此刻核心线程池中一个worker都没有了，而线程池中的任务队列还存在一个A线程提交的任务T，这样就会导致这个任务永远无法被执行。所以在上面的else if中才会对当前线程池中的worker进行非零判断避免这种极端情况的发生，保证线程池中至少有一个worker在工作。

### 线程池已关闭或者任务队列已满

对应于addWorker方法中的代码如下

```java
else if (!addWorker(command, false))
    reject(command);
```

这个else if是与上面的**线程池正在运行并且核心线程数已满但任务队列未满**相对应的，能够执行这个else if代表以下两种情况：

1. 线程池已关闭
2. 任务队列已满

在以上两种情况下会尝试新增一个worker而addWorker方法返回false代表当前线程池已经饱和了或者线程池已经关闭了此时则会调用reject方法拒绝该任务。

至此为止整个execute方法的主干部分的执行逻辑已经大体上梳理清晰了，不过其中还有很多比较晦涩难懂的地方没有理解，等以后有空再来补那些坑吧。下面对execute方法做一个总结：

执行线程池的execute方法相当于将一个Runnable类型的任务提交给了线程池，接下来线程池会根据线程池被构造时的corePoolSize、maximumPoolSize、keepAliveTime等参数来确定如何处理这个任务。如果当前线程池中的线程数没有超过corePoolSize则会尝试新增一个worker来处理这个任务。否则的话则会尝试将这个任务添加到任务队列中以便接下来其它核心线程从队列中取出这个任务并处理。如果无法将这个任务放进队列那么很有可能当前线程池已经被关闭了或者任务队列已满了此时则会尝试新建一个非核心的worker来处理这个任务。

## shutdown方法

shutdown方法的作用是尝试唤醒那些由于拿不到任务而阻塞在队列中或者还未正式运行的worker以便这些线程能够从队列中将任务都尽快的执行完。底层时通过设置线程的中断标志为true，这样的话基于AQS或者LockSupport来实现阻塞线程的同步类则不会阻塞线程，然后这些被设置中断标记的worker就能够持续不断的从阻塞队列中获取任务并执行任务直到任务队列为空最终线程池中的所有worker都将退出。

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

执行shutdown方法时必须获取主锁，然后调用checkShutdownAccess方法检查权限（不是重点）接下来advanceRunState方法修改线程池状态为SHUTDOWN

### advanceRunState方法

```java
private void advanceRunState(int targetState) {
    for (;;) {
        int c = ctl.get();
        if (runStateAtLeast(c, targetState) ||
            ctl.compareAndSet(c, ctlOf(targetState, workerCountOf(c))))
            break;
    }
}
```

自旋判断当前线程池的状态是否至少为传入的targetState，此时传入的是SHUTDOWN，如果当前线程池已经处于SHUTDOWN的话就break跳出循环即可，否则的则通过cas尝试将当前线程池的ctl重新打包为方法传入的targetState与当前线程池的线程数，cas失败代表有其它线程正在修改ctl那么只需要在下次自旋时重新判断当前线程池的状态或者重新打包ctl即可。

将线程池状态修改为SHUTDOWN之后接着调用interruptIdleWorkers方法**唤醒那些不是正在执行任务的worker（空闲的worker）**

### interruptIdleWorkers方法

```java
private void interruptIdleWorkers(boolean onlyOne) {
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        for (Worker w : workers) {
            Thread t = w.thread;
            if (!t.isInterrupted() && w.tryLock()) {
                try {
                    t.interrupt();
                } catch (SecurityException ignore) {
                } finally {
                    w.unlock();
                }
            }
            if (onlyOne)
                break;
        }
    } finally {
        mainLock.unlock();
    }
}
```

interruptIdleWorkers方法的执行逻辑很简单，只要当前线程不是出于中断状态，然后调用worker的tryLock方法尝试获取worker的锁，还记得runWorker方法吗

```java
 while (task != null || (task = getTask()) != null) {
       w.lock();
 }
```

worker在拿到任务的第一步就是给自己上锁代表worker当前正在执行任务，执行`w.lock();`这段代码后AQS的state就变成了1，而tryLock方法调用的是tryAcquire方法

```java
protected boolean tryAcquire(int unused) {
    if (compareAndSetState(0, 1)) {
        setExclusiveOwnerThread(Thread.currentThread());
        return true;
    }
    return false;
}
```

很显然如果worker正在执行任务，这个tryAcquire方法必定时返回false的，所以interruptIdleWorkers方法会将那些不是正在执行任务的worker或者还未开始执行任务的worker（还没执行到runWorker中的while循环中）都设置为中断状态，这样的话这些被中断的线程在下次执行getTask方法调用队列的take获取poll方法拿任务的时候就不会被阻塞了，不懂原理的可以去看LockSupport和AQS相关的知识点。阻塞队列都是基于这两个东西实现的。接下来这些永远不会被阻塞的worker就会不停的消耗队列中的任务然后退出，接下来那些刚刚由于真正执行任务而没有设置中断标记的worker执行下一次getTask的时候会发现线程池的状态已经为SHUTDOWN了慢慢的在队列中的任务都被执行完毕之后就会进入getTask方法的这段退出代码中

```java
if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
    decrementWorkerCount();
    return null;
}
```

最终线程池中的所有worker都将退出，任务都被执行完毕。

## shutdownNow方法

shutdownNow方法的作用是中断当前线程池中所有已启动的worker线程，这样那些所有正在运行的线程在执行完任务后重新执行getTask方法时就会直接退出，我们看一下shutdownNow方法的代码

```java
public List<Runnable> shutdownNow() {
    List<Runnable> tasks;
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        checkShutdownAccess();
        advanceRunState(STOP);
        interruptWorkers();
        tasks = drainQueue();
    } finally {
        mainLock.unlock();
    }
    tryTerminate();
    return tasks;
}
```

首先第一步检查Shutdown权限（不是重点），然后通过advanceRunState方法将当前线程状态设置为STOP，接着调用interruptWorkers方法中断线程池中所有已启动的线程，最终将那些未执行的任务存放到一个list中。首先我们先来看一下interruptWorkers方法时如何中断线程的

### interruptWorkers方法

```java
private void interruptWorkers() {
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        for (Worker w : workers)
            w.interruptIfStarted();
    } finally {
        mainLock.unlock();
    }
}
```

执行逻辑很简单，遍历线程池中所有的worker调用interruptIfStarted方法

```java
void interruptIfStarted() {
    Thread t;
    if (getState() >= 0 && (t = thread) != null && !t.isInterrupted()) {
        try {
            t.interrupt();
        } catch (SecurityException ignore) {
        }
    }
}
```

这个中断方法也很简单，只要当前worker的AQS状态大于等于0（已启动）并且它自己本身没有被中断的话就将这个worker线程的中断标记设置为true。接下来那些正在运行的worker或者拿不到任务的worker在下一次执行getTask方法的时候退出

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
        ......省略部分代码
    }
```

在上面的getTask执行一开始会先判断当前线程池的状态，如果是STOP的话这个worker线程就会退出。同时如果当前线程池中存在拿不到任务而阻塞的线程，由于所有的worker的线程都被设置了中断标记，这些线程都会被唤醒或者抛出InterruptedException（LockSupport和AQS的原因）从而重新执行上面的自旋最终退出。

接下来我们继续看一下是如何将那些未完成的任务重现保存起来的。

### drainQueue方法

```java
private List<Runnable> drainQueue() {
    BlockingQueue<Runnable> q = workQueue;
    ArrayList<Runnable> taskList = new ArrayList<Runnable>();
    q.drainTo(taskList);
    if (!q.isEmpty()) {
        for (Runnable r : q.toArray(new Runnable[0])) {
            if (q.remove(r))
                taskList.add(r);
        }
    }
    return taskList;
}
```

drainQueue方法的执行逻辑也很简单，通过BlockingQueue自带的drainTo方法将内部剩余的所有任务都转移到另一个集合中，但是有一些特殊的队列例如DelayQueue是无法立即通过drainTo方法将任务进行转移的，因此可能需要通过remove方法尝试将这些任务强制删除然后转移到新队列中。

## awaitTermination方法

awaitTermination方法的作用时阻塞当前线程直到当前线程池被关闭或者在指定的时间后超时。

```java
public boolean awaitTermination(long timeout, TimeUnit unit)
    throws InterruptedException {
    long nanos = unit.toNanos(timeout);
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        for (;;) {
            if (runStateAtLeast(ctl.get(), TERMINATED))
                return true;
            if (nanos <= 0)
                return false;
            nanos = termination.awaitNanos(nanos);
        }
    } finally {
        mainLock.unlock();
    }
}
```

整个执行逻辑很简单，获取mainLock，判断当前线程池是否已经终止了以及传递的超时时间是否为0，否则的话就通过mainLock的termination这个Condition使当前线程阻塞指定的时间。注意`termination.awaitNanos(nanos);`方法返回的值代表的是**方法传入的超时时间减去线程阻塞的耗时时间**，也就是说整个awaitTermination如果返回true的话代表当前线程池能够在指定的超时时间内被终止，否则的话则代表经过指定的超时时间线程池还未被终止。

## 总结

ThreadPoolExecutor的主体部分已经分析完了，其中的难点在于execute方法，从任务被提交的那一刻开始就有可能存在其它线程并发的往线程池中提交任务甚至是关闭线程池、动态改变线程池的核心参数等等操作，因此需要在关键的地方通过CAS对当前线程池的核心线程数与最大线程数和线程池的状态进行判断，避免错误的提交和执行任务。在我没有深入了解线程池的原理之前，我一直以为核心线程与非核心线程是通过某个标记字段来区分的，事实上在ThreadPoolExecutor中，核心线程与非核心线程没有什么区别，它们只是在数量上有区别而已，很有可能一个执行任务过快的核心线程会由于另一个非核心线程执行一个耗时的任务导致在指定的keepAliveTime之后这个核心线程被移除，从而使刚刚那个非核心线程转换为核心线程。核心与非核心线程的超时机制以及这两种线程间的转换完全是在内部的getTask方法中进行判断的。

## 资料来源

- [ThreadPoolExecutor：执行与关闭契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)
- [OpenJDK：JDK 源码仓库](https://github.com/openjdk/jdk)
