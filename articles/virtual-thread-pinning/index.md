---
title: "JDK 24 后 synchronized 为什么不再固定虚拟线程"
date: "2026-09-11"
updated: "2026-10-01"
domain: "JVM"
tags: ["JVM", "VirtualThreads", "并发"]
---

把 Java 服务切换到虚拟线程后，是否需要把所有 `synchronized` 换成 `ReentrantLock`？在 JDK 21～23 上，持锁时阻塞确实可能固定 Carrier；JDK 24 的 JEP 491 改变了 Monitor 实现，这个替换理由已经不再普遍成立。

本文比较 JDK 21～23 与 24/25 的已知行为，现行 API 说明采用 Java SE 25。需要区分三类现象：虚拟线程无法卸载、线程在竞争同一把锁，以及下游资源已经用尽。它们都可能造成延迟，却需要不同的处理。[JEP 491](https://openjdk.org/jeps/491) · [Java 25 虚拟线程指南](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html)

## 持锁等待 HTTP 时，版本改变了什么

下面是应用代码片段，省略 `java.net.http` 和 `java.io` 等标准库 import。所有调用共享同一把锁：

```java
public final class UserProfileService {

    private final Object lock = new Object();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public String loadProfile(HttpRequest request)
            throws IOException, InterruptedException {
        synchronized (lock) {
            return httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString()
            ).body();
        }
    }
}
```

如果该方法运行在虚拟线程中，HTTP 请求等待响应时会发生什么？

答案取决于 JDK 版本：

| 运行版本                  | 阻塞时的典型行为                           |
| --------------------- | ---------------------------------- |
| JDK 21～23             | 持有 Monitor 的虚拟线程可能无法卸载，Carrier 被固定 |
| JDK 24+               | `synchronized` 本身不再阻止虚拟线程卸载        |
| 本文涉及版本的 Native/FFM 阻塞调用 | 仍可能固定 Carrier                      |

但即使使用 JDK 24，这段设计仍有问题：所有调用者都必须持有同一把锁才能发起 HTTP 请求。Carrier 可以复用，并不意味着业务并发度得到提升；锁仍然把请求串行化了。

## 卸载、固定与 CPU 占用

### Virtual Thread 与 Carrier Thread

平台线程通常与操作系统线程一一对应，创建数量受到栈内存和操作系统资源限制。

虚拟线程由 JVM 调度，通过少量平台线程运行：

```text
Virtual Thread A ─┐
Virtual Thread B ─┼── JVM Scheduler ── Carrier Threads ── OS Threads
Virtual Thread C ─┤
Virtual Thread D ─┘
```

Oracle 的 Java 25 `Thread` 文档说明，虚拟线程适合大量主要等待 I/O 的任务，而不适合长时间占用 CPU 的计算；单个 JVM 可以支持非常多的虚拟线程，其底层通常只使用较少的 Carrier。[Java SE 25：Thread](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)

### Mount、Unmount 与 Pinning

虚拟线程执行代码时，会挂载到某个 Carrier：

```text
Virtual Thread → mount → Carrier → 执行
```

遇到 JVM 支持的阻塞操作时，理想过程是：

```text
Virtual Thread 阻塞
    → 保存执行状态
    → 从 Carrier 卸载
    → Carrier 执行其他 Virtual Thread
    → 阻塞条件满足
    → 重新挂载到某个 Carrier
```

重新挂载时不要求使用原来的 Carrier。

当线程处于无法卸载的状态时称为 Pinning；它在此期间阻塞，才会同时占住 Carrier：

```text
Virtual Thread 阻塞
    → 无法卸载
    → Carrier 同时被阻塞
```

如果少量请求偶尔固定 Carrier，通常只有有限影响；如果大量长时间 Pinning 同时发生，可运行的 Carrier 数量会下降，等待执行的虚拟线程不断积压，最终降低吞吐量并放大尾延迟。

Pinning 一般不会直接改变程序结果，它首先是可伸缩性问题。

### CPU 占用不是 Pinning

虚拟线程执行 CPU 密集型代码时也会持续占用 Carrier：

```java
while (hasMoreWork()) {
    calculateNextBlock();
}
```

但这不叫 Pinning。此时线程没有因为阻塞而尝试卸载，只是在正常使用 CPU。

两者的优化方向不同：

* CPU 饱和：减少计算、并行度或算法成本。
* Pinning：找出阻止卸载的阻塞边界。
* 锁竞争：缩短临界区或重新设计共享状态。
* 下游饱和：限制并发并实施背压。

## Monitor 所有权为何影响调度

### JDK 21～23 为什么会被 synchronized 固定

`synchronized` 通过 JVM Monitor 提供互斥、可重入和内存可见性。

在早期虚拟线程实现中，Monitor 所有权及相关锁状态与执行虚拟线程的 Carrier 存在实现层面的关联。虚拟线程如果在持有 Monitor 时卸载，随后可能被挂载到另一个 Carrier，这会破坏旧实现对锁所有权的假设。

因此：

```text
Virtual Thread
    → 在 Carrier-1 上进入 synchronized
    → 持有 Monitor
    → 执行阻塞操作
    → 无法安全地迁移到 Carrier-2
    → 固定 Carrier-1
```

`ReentrantLock` 等 `java.util.concurrent` 同步器基于可挂起的等待机制实现，所以在 JDK 21～23 中，将长时间阻塞区域从 `synchronized` 改为适当的显式锁，曾是一种规避方法。

### JEP 491 改变了什么

JEP 491 修改了 HotSpot 的 Monitor 实现，使 Monitor 所有权能够与虚拟线程本身关联，而不再要求虚拟线程始终绑定于取得锁时的 Carrier。

于是，JDK 24+ 可以支持：

```text
Virtual Thread
    → 在 Carrier-1 上进入 synchronized
    → 持有 Monitor
    → 遇到可卸载的阻塞操作
    → 从 Carrier-1 卸载
    → 稍后挂载到 Carrier-2
    → 继续持有并最终释放同一个 Monitor
```

这保留了 Java Monitor 的互斥与 happens-before 语义，只改变虚拟线程与 Carrier 的调度关系。

JEP 491 的目标之一就是让现有大量使用 `synchronized` 的 Java 代码能够直接受益于虚拟线程，而不必为了调度兼容性大规模改写锁实现。[OpenJDK JEP 491](https://openjdk.org/jeps/491)

### 为什么 Native 调用仍可能 Pinning

进入 JNI Native Method 或 Foreign Function 后，JVM 无法像处理普通 Java 栈帧一样，随时保存、移动并恢复外部代码的执行状态。

因此，当虚拟线程正在 Native 或 Foreign Function 中运行时，它仍可能无法从 Carrier 卸载。Oracle 当前文档将这两类调用列为仍会发生 Pinning 的情况。[Oracle Java 25 虚拟线程指南](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html)

需要关注的不是“依赖中是否存在 Native 代码”，而是：

```text
Native/FFM 调用是否会长时间阻塞
×
调用并发量是否很高
×
持续时间是否足以耗尽 Carrier
```

短暂、低频的 Native 调用通常不值得复杂改造。

## 观察调度差异，并保留状态一致性

运行前提：虚拟线程要求 Java 21+；要获得 `synchronized` 不再导致 Pinning 的行为，需要 JDK 24+。

### 持锁执行慢操作

```java
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class SynchronizedBlockingDemo {

    private static final Object[] LOCKS = new Object[1_000];

    static {
        for (int index = 0; index < LOCKS.length; index++) {
            LOCKS[index] = new Object();
        }
    }

    public static void main(String[] args) throws InterruptedException, ExecutionException {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> tasks = new ArrayList<>();
            for (int index = 0; index < LOCKS.length; index++) {
                int taskIndex = index;

                tasks.add(executor.submit(() -> {
                    synchronized (LOCKS[taskIndex]) {
                        Thread.sleep(Duration.ofSeconds(1));
                    }
                    return null;
                }));
            }

            for (Future<?> task : tasks) {
                task.get();
            }
        }
    }
}
```

每个任务使用不同的共享锁，避免所有任务因为同一把锁而串行：

* JDK 21～23：睡眠发生在 `synchronized` 内，可能固定大量 Carrier。
* JDK 24+：持有 Monitor 不再阻止虚拟线程在睡眠时卸载。

保存为 `SynchronizedBlockingDemo.java` 即可编译运行。程序等待每个任务的 Future，避免把任务异常留在未读取的结果中。它用于比较调度行为，不是性能基准；不同 JDK 的运行时间还受 CPU、调度器并行度和机器负载影响。不能只跑一个版本就声称已经验证版本间提升。

### 缩短临界区仍然有价值

假设请求需要基于本地状态调用远程服务：

```java
public Result process(long userId) throws Exception {
    RequestSnapshot snapshot;

    synchronized (stateLock) {
        snapshot = state.createSnapshot(userId);
    }

    RemoteResult remoteResult = remoteClient.execute(snapshot);

    synchronized (stateLock) {
        return state.applyIfCurrent(snapshot.version(), remoteResult);
    }
}
```

与把整个远程调用放入锁内相比，这种结构：

1. 在锁内取得不可变快照。
2. 在锁外执行慢速 I/O。
3. 再次加锁并校验版本。
4. 仅在状态仍符合预期时提交结果。

JDK 24 解决的是 Carrier Pinning，并没有改变“长时间持锁会阻塞其他调用者”这一事实。把 I/O 移出临界区仍然可能显著提高业务并发度，但必须通过版本校验或状态机保证正确性。

## 用运行证据决定是否调整实现

### 使用 JFR 查找真实 Pinning

Oracle 文档说明，JFR 的 `jdk.VirtualThreadPinned` 事件默认启用，默认阈值为 20 毫秒。可以采集一段代表真实流量的记录：

```bash
java -XX:StartFlightRecording=filename=app.jfr,duration=60s \
     -jar application.jar
```

查看 Pinning 事件：

```bash
jfr print --events jdk.VirtualThreadPinned app.jfr
```

重点分析：

* 固定持续时间，而不只是事件数量。
* 调用栈是否指向 Native 或 FFM 边界。
* Pinning 是否与延迟尖峰同时发生。
* 高峰期是否出现可运行虚拟线程积压。
* 数据库、HTTP 和连接池是否已经先达到容量上限。

还可以生成包含虚拟线程信息的线程转储：

```bash
jcmd <PID> Thread.dump_to_file -format=json threads.json
```

相关诊断命令与 JFR 事件由 Oracle 虚拟线程指南说明。[Oracle Java 25 虚拟线程指南](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html)

### 不要通过池化虚拟线程限制并发

虚拟线程通常采用“一任务一线程”：

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(task);
}
```

如果数据库最多允许 50 个并发查询，应限制数据库操作，而不是创建一个包含 50 个虚拟线程的线程池：

```java
public final class LimitedRepository {

    private final Semaphore permits = new Semaphore(50);
    private final UserRepository repository;

    public LimitedRepository(UserRepository repository) {
        this.repository = repository;
    }

    public User find(long id) throws InterruptedException {
        permits.acquire();
        try {
            return repository.find(id);
        } finally {
            permits.release();
        }
    }
}
```

线程代表任务，`Semaphore` 代表需要单独限制的操作容量。数据库连接池本身已经限制同时占用的连接数；只有需要限制等待者数量、提前拒绝或控制另一类资源时，才应再增加独立限制，而不是机械叠加一个相同大小的信号量。

### 按语义选择锁

JDK 24+ 中，选择 `ReentrantLock` 的合理原因包括：

* 需要 `tryLock()`。
* 需要可中断加锁。
* 需要多个 `Condition`。
* 需要定时等待。
* 明确需要公平锁策略。

如果只需要简单的互斥和内存可见性，`synchronized` 仍然具有语法简单、自动释放且容易审查的优势。

### 对阻塞 Native 调用建立隔离边界

若确认某个第三方库在 Native 调用中长时间阻塞，可以考虑：

* 升级或替换为虚拟线程友好的实现。
* 限制该调用的最大并发量。
* 使用独立且有界的平台线程执行器进行隔离。
* 配置底层连接和读取超时。
* 监控执行队列、拒绝次数和最长等待时间。

扩大 Carrier 数量只能缓解症状，还可能把压力继续传递给数据库或外部服务，不应作为首选修复。

诊断时先确认生产运行的 JDK，再关联 JFR、锁等待和连接池指标。没有 Pinning 事件并不证明系统没有阻塞瓶颈；同样，短暂的 Native 调用也不自动构成需要隔离或替换的缺陷。应针对已经影响吞吐量或尾延迟的实际等待，选择最小的有效改动。
