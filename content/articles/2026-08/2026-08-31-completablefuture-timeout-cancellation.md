---
title: "CompletableFuture 超时为何不会停止底层任务"
date: "2026-08-31"
updated: "2026-10-01"
id: "2026-08-31-completablefuture-timeout-cancellation"
domain: "Java 并发"
tags: ["Java", "CompletableFuture", "并发"]
---

给并行调用加上 `CompletableFuture.orTimeout()`，可以让调用方及时得到超时结果，但后台任务可能仍在执行。若它持有数据库连接或占用线程池，用户已经收到失败，资源压力却不会随之消失。

理解这一行为，需要区分两个对象：一个是计算结果的完成状态，另一个是产生结果的任务。`CompletableFuture` 主要管理前者；停止后者还需要任务或底层 I/O 配合。本文按 Java SE 25 的公共契约解释，示例只使用 Java 9 起已有的 API。

## 超时争夺的是完成状态

```java
CompletableFuture<String> result = CompletableFuture
        .supplyAsync(this::slowQuery, executor)
        .orTimeout(500, TimeUnit.MILLISECONDS);
```

`orTimeout()` 返回并修改同一个 `CompletableFuture`。如果它在期限内尚未完成，定时操作尝试以 `TimeoutException` 使其异常完成；业务任务也在尝试写入正常结果。先完成的一方决定最终状态，随后完成的任务不能覆盖它。

这种竞争不会自动向 `slowQuery()` 所在的线程发送中断。`completeOnTimeout(defaultValue, ...)` 的区别只是写入默认值，同样不提供任务停止或资源释放保证。

`CompletableFuture.cancel(true)` 也不能补上这一层控制。该类的 `mayInterruptIfRunning` 参数不起中断作用，取消被当作异常完成；这与执行器提交任务后返回的可中断 `Future` 需要分别理解。[CompletableFuture：完成、超时与取消](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html)

## 把结果超时与任务结束分别观察

下面是完整示例，保存为 `TimeoutDoesNotCancel.java`。工作线程先报告已经启动，然后等待一个闩锁；主线程让 Future 超时，再释放闩锁。这样无需把某个机器上的睡眠时间当作可重复的计时保证。

```java
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class TimeoutDoesNotCancel {

    public static void main(String[] args) throws InterruptedException {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(1);

        try {
            CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
                started.countDown();
                try {
                    release.await();
                    return "done";
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new CompletionException(exception);
                } finally {
                    finished.countDown();
                }
            }, executor);

            started.await();
            future.orTimeout(100, TimeUnit.MILLISECONDS);
            try {
                future.join();
            } catch (CompletionException exception) {
                System.out.println(exception.getCause().getClass().getSimpleName());
            }

            System.out.println("任务已结束: " + (finished.getCount() == 0));
            release.countDown();
            finished.await();
            System.out.println("释放后任务已结束: " + (finished.getCount() == 0));
        } finally {
            release.countDown();
            executor.shutdown();
        }
    }
}
```

预期输出为：

```text
TimeoutException
任务已结束: false
释放后任务已结束: true
```

闩锁把观察点固定在底层任务尚未结束的时刻。Future 已经超时，工作线程仍能继续运行；即使它后来返回 `"done"`，Future 的异常结果也不会改变。

示例显式调用 `shutdown()`，因而可用于 Java 9+。如果改写成 `try (ExecutorService executor = ...)`，则需要 Java 19+；`ExecutorService.close()` 还会等待任务结束，不能把退出代码块的耗时误认为 `orTimeout()` 没有生效。[ExecutorService.close](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html#close())

## 取消与资源回收要落到底层操作

为 HTTP、数据库、Redis 等调用设置连接、读取或查询超时，能约束相应资源实际被占用的时间。外层 Future 的超时适合定义调用方愿意等待多久，这两个边界通常需要同时存在。

如果需要主动发出中断，应保留 `ExecutorService.submit()` 返回的任务 `Future<?>`，由任务控制路径调用 `cancel(true)`。它表示尝试中断执行线程，仍不等于强制终止：长循环需要检查中断状态，阻塞操作需要支持中断，已对外产生的副作用也不会自动回滚。

并行调用多个下游时，还要明确每个子任务由谁取消、未完成任务由谁等待和清理。只把多个 Future 用 `allOf()` 组合，或者让其中一个结果提前超时，不会自动建立这些生命周期规则。检查超时机制是否有效时，应同时观察响应完成、工作线程退出和连接归还，而不只观察异常类型。
