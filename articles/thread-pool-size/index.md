---
title: "线程池的最大线程数为什么没有生效"
date: 2026-09-15
updated: 2026-10-03
domain: "Java 并发"
tags: ["ThreadPoolExecutor","队列","过载保护"]
---

线程池设了 `corePoolSize=2`、`maximumPoolSize=4`，任务已经排成长队，线程数却始终是 2。这往往不是扩容失效，而是队列一直愿意接收任务：标准 `ThreadPoolExecutor` 到达核心线程数后先入队，入队失败才尝试扩容。

因此，最大线程数必须与队列容量一起看。若希望限制在线请求的等待时间和内存占用，需要同时设计核心线程数、有界队列、扩容上限和拒绝结果；单独把 `maximumPoolSize` 调大，不会提高一个持续接受排队任务的池的执行并发。

以下讨论标准 JDK 队列与平台线程，运行中不修改配置，也不自定义 `offer` 语义。API 与实验统一以 JDK 25 LTS 为基线，示例只依赖标准库。

## 队列怎样决定扩容和等待

线程池同时管理两类不同资源：正在执行任务的 worker，以及等待执行的任务引用。线程数限制前一类，队列容量限制后一类。服务还能接收多少工作，不能只看一个线程数参数。

默认构造的 `LinkedBlockingQueue` 容量为 `Integer.MAX_VALUE`，并非数学意义的无限；还可以显式传入容量，把同一类队列变成有界队列。它按需创建链表节点，任务闭包持有的请求体、上下文和回调也可能随排队保留。因此“无界队列”通常表示缺少有效的业务容量限制，并不意味着预先分配了几十亿个槽位。[LinkedBlockingQueue 构造与容量](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html)

以一个刻意简化的容量模型理解风险：假设每个任务占用 worker 100 ms，没有共享瓶颈，则 2 个 worker 约能完成 20 个任务/秒。若每秒持续接纳 30 个任务，积压约每秒增加 10 个；一分钟后约有 600 个任务等待，需要约 30 秒才能消化这批工作。即使堆还有空间，业务时限也可能早已失守。

这些数字是按给定假设推算的示例，不是基准测试。在真实系统中，服务时间的长尾、下游拥塞和重试会让积压更复杂。关键判断仍成立：持续接纳速度超过实际完成速度时，增加缓冲只能推迟暴露问题。

## 一次 execute 的四条接纳路径

在线程创建正常、线程池保持运行的前提下，每次 `execute` 依次尝试以下路径。实现还会在入队后复查运行状态，并处理 worker 数量变化；表格只展开影响容量设计的接纳顺序。

| 接纳顺序 | 条件 | 动作 |
| --- | --- | --- |
| 1 | worker 数低于核心值 | 尝试创建 worker 处理新任务 |
| 2 | 已达核心值，队列能接收 | 任务入队 |
| 3 | 队列不能接收，尚可增加 worker | 尝试扩容处理新任务 |
| 4 | 无法接纳 | 调用拒绝处理器 |

这里使用队列的即时 `offer`，不会因为类型叫 `BlockingQueue` 就自动等待空位。`ArrayBlockingQueue.put` 在队列满时会等待，`offer` 则返回失败；这两个 API 的差异正是“排队失败后扩容”能够发生的原因。[ArrayBlockingQueue 方法语义](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html)

### 队列满，才轮到最大线程数

假设前面的任务全部被闩锁阻塞，核心值为 2、最大值为 4、队列容量为 2：任务 1、2 占据两个 worker，任务 3、4 入队，任务 5、6 触发新增 worker，任务 7 被拒绝。因此刚提交的任务 5 可能比排队的任务 3 先开始；队列内部的 FIFO 不等于线程池全局按提交顺序启动或完成。这一现象可从下面实验的“4 个 worker 已启动、2 个任务仍排队”直接观察。

### 没有缓冲位置时如何交接

`SynchronousQueue` 不储存元素，只有与等待接收者配对才能交接；没有可接收 worker 时，接纳路径更快进入扩容或拒绝。它适合明确不要积压的场景，但必须配合有限的最大线程数和失败处理，不能把无界排队变成无界创建线程。[SynchronousQueue 交接语义](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html)

### 接纳失败后，Future 会怎样

`AbortPolicy` 抛出 `RejectedExecutionException`；调用方能把它转换为明确的繁忙响应。拒绝也可能因为线程池已关闭，不能把每次拒绝都统计成容量不足。[AbortPolicy](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.AbortPolicy.html) · [RejectedExecutionHandler](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RejectedExecutionHandler.html)

`CallerRunsPolicy` 在池未关闭时，让提交者自己运行任务；池已关闭则丢弃任务。由此可推断：它可能降低一个生产者的提交速度，却不保证整个系统的任务并发数被 `maximumPoolSize` 限住——多个提交者可以各自执行任务。对于事件循环或持锁调用方，同步执行还会延长该线程占用时间，应审查调用环境再选用。[CallerRunsPolicy](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.CallerRunsPolicy.html)

还有一个容易遗漏的后果：`submit` 会建立 `RunnableFuture`，默认实现为 `FutureTask`。若处理器静默丢弃它，既没有执行、取消，也没有把失败通知给它，调用方拿到的 Future 就可能一直未完成；这种组合的风险来自两个 API 的生命周期不衔接，下面同时演示关闭后的 `CallerRunsPolicy` 情况。[AbstractExecutorService](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/AbstractExecutorService.html) · [FutureTask](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/FutureTask.html) · [DiscardPolicy](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.DiscardPolicy.html)

## 用闩锁固定线程池的接纳状态

为了看清接纳顺序，需要让先提交的任务停在可控位置。否则它们可能很快执行完，后一个任务就会用到刚空出来的线程，无法与前面的容量表直接比较。

将以下完整代码保存为 `PoolAdmissionDemo.java`。使用 JDK 25 LTS，运行 `java PoolAdmissionDemo.java`；无需第三方依赖。代码用闩锁固定任务占用状态，不靠 `sleep` 猜测调度时机。5 秒是实验失败上限，不是生产任务超时配置。

```java
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public final class PoolAdmissionDemo {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void probe(String name, BlockingQueue<Runnable> queue,
                              int workers, int queued, int rejected)
            throws InterruptedException {
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch started = new CountDownLatch(workers);
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                2, 4, 30, TimeUnit.SECONDS, queue,
                new ThreadPoolExecutor.AbortPolicy());
        Runnable task = () -> {
            started.countDown();
            try {
                release.await();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        };
        try {
            int rejectedCount = 0;
            for (int i = 0; i < 7; i++) {
                try {
                    pool.execute(task);
                } catch (RejectedExecutionException ex) {
                    rejectedCount++;
                }
            }
            check(started.await(5, TimeUnit.SECONDS), "workers did not start");
            check(pool.getPoolSize() == workers, "worker count");
            check(queue.size() == queued, "queue size");
            check(rejectedCount == rejected, "rejection count");
            System.out.printf("%s: workers=%d queued=%d rejected=%d%n",
                    name, pool.getPoolSize(), queue.size(), rejectedCount);
        } finally {
            release.countDown();
            pool.shutdown();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
                pool.shutdownNow();
                throw new AssertionError("pool did not terminate");
            }
        }
    }

    private static void discardedFuture() throws InterruptedException {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                1, 1, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(1),
                new ThreadPoolExecutor.CallerRunsPolicy());
        pool.shutdown();
        check(pool.awaitTermination(5, TimeUnit.SECONDS), "shutdown failed");
        Future<Integer> future = pool.submit(() -> 42);
        check(!future.isDone(), "discarded task should still be incomplete");
        System.out.println("shutdown + CallerRunsPolicy: future.isDone=false");
        future.cancel(false); // 清理这个无人执行的 Future；不要调用无超时 get。
    }

    public static void main(String[] args) throws InterruptedException {
        probe("unbounded", new LinkedBlockingQueue<>(), 2, 5, 0);
        probe("bounded(2)", new ArrayBlockingQueue<>(2), 4, 2, 1);
        probe("handoff", new SynchronousQueue<>(), 4, 0, 3);
        discardedFuture();
    }
}
```

### 对照三种队列的结果

在 Windows、Oracle JDK 25.0.2 LTS 下执行源文件，输出如下；程序会检查工作线程数、排队量和拒绝结果。

```text
unbounded: workers=2 queued=5 rejected=0
bounded(2): workers=4 queued=2 rejected=1
handoff: workers=4 queued=0 rejected=3
shutdown + CallerRunsPolicy: future.isDone=false
```

精确数量依赖闩锁阻止任务完成，生产环境的快照会随任务进出变化。该实验用于解释接纳路径与 Future 状态；吞吐和尾延迟仍须使用真实业务负载测量。

## 从下游容量和等待预算选择配置

### 线程与队列共享同一份服务预算

若数据库只允许这类任务同时占用 16 个连接，把线程池设成 200 个并不能凭空增加数据库处理能力。先测量指定并发下的完成速率与服务时间，再把它作为在线接纳预算；CPU 密集与阻塞任务最好分别验证，不共用一个未经测量的默认配置。

排队容量也可以从等待预算反推。例如可持续完成速率约为 100 个/秒，希望排队最多占用约 200 ms，则约 20 个待处理任务可作为初始实验量级：`100 × 0.2 = 20`。这只是平滑吞吐假设下的起点，不是尾延迟保证；若核心线程阶段只能完成 25 个/秒，队列尚未满时同样 20 个任务就可能需要约 800 ms。必须分别测量扩容前后，而不是用最大线程数下的吞吐解释全部请求。

### 拒绝与监控共同暴露过载

对有返回结果的业务，优先使用显式异常或显式失败结果，并把线程池关闭与运行中饱和分别计数。只有业务允许放弃结果，且确实观察丢弃数量时，才考虑丢弃策略；不要在拒绝回调中无限重试，也不要直接向内部队列 `put` 来绕过接纳和关闭语义。上游如需重试，应受重试次数、退避和总时限约束。

为了判断限制究竟落在哪里，至少采集提交至开始的排队时间、开始至结束的执行时间、队列长度与拒绝数量；辅以 worker 数、下游连接等待和请求总时限。`getActiveCount()` 本身是近似统计，不能拿它在业务线程里先判断“有空位”再提交，替代线程池的真实接纳结果。[ThreadPoolExecutor 监控方法](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html#getActiveCount())

可以按下面的观测组合定位，表中是诊断假设，需要用线程状态与负载测试确认：

| 观测 | 优先核查 |
| --- | --- |
| 队列持续增长，worker 停在核心值 | 队列是否过大，是否始终能 `offer` 成功 |
| worker 已扩容，完成速率没变 | 下游连接、锁竞争或 CPU 是否饱和 |
| 队列不长，端到端延迟很高 | 任务执行本身是否阻塞，或提交者正在 CallerRuns |
| 拒绝突然增加，资源利用率反而低 | 线程池是否进入关闭流程，生命周期是否误用 |

有界队列也没有自动淘汰超时任务。若任务排队期间已经失去业务价值，可在真正开始工作时再次核对截止时间；取消、退款、消息确认等有副作用操作则需要各自的业务完成协议，不能仅以线程池接纳状态替代。

如果父任务占满 worker，并等待同一个池里排队的子任务，有界队列仍可能使任务无法推进。此时需要调整任务依赖和执行边界，不能依赖偶然扩容来解开等待。
