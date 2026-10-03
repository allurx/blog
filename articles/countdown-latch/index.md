---
title: "CountDownLatch 源码分析"
date: 2019-09-11
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - 同步工具
domain: Java
---

主线程把两项工作交给两个 Worker 后，希望等它们都结束再输出报告。如果只等待其中一个线程，另一个可能还没完成；如果一直轮询两个标记，又需要自己处理等待和可见性。`CountDownLatch(2)` 可以直接表达这个约定：每项工作结束时减一，报告线程等待计数归零。

计数代表要等到的事件次数，并不要求一次事件对应一个线程。同一个线程可以报告多次事件，多个线程也可以等待同一个门闩。归零后门闩一直开放，不能重置。

下面先用两个门闩串起“开始”和“完成”，再分析 [OpenJDK 8u202-b08 的 AQS 共享实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/CountDownLatch.java)。完整示例只依赖标准库，目标运行环境为 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）；源码中的队列实现以链接的 Java 8 版本为准。

## 两个门闩分别控制开始与结束

startSignal 初始为 1，用于统一放行；doneSignal 初始为 2，表示两个 Worker 结束后 main 才能继续。Worker 在 finally 中 countDown，避免已结束的失败路径忘记报告完成。

保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`：

```java
package io.allurx;


import java.time.LocalTime;
import java.util.concurrent.CountDownLatch;

/**
 * @author allurx
 */
public class DemoApplication {

    private static CountDownLatch startSignal = new CountDownLatch(1);
    private static CountDownLatch doneSignal = new CountDownLatch(2);

    public static void main(String[] args) throws InterruptedException {
        System.out.println("main线程开始运行：" + LocalTime.now());
        new Thread(new Worker(), "Worker1").start();
        new Thread(new Worker(), "Worker2").start();
        Thread.sleep(2000);

        // 唤醒两个Worker线程
        startSignal.countDown();

        // 阻塞main线程直到Worker线程执行完毕
        doneSignal.await();
        System.out.println("main线程运行结束：" + LocalTime.now());
    }

    static class Worker implements Runnable {

        @Override
        public void run() {
            try {
                startSignal.await();
                System.out.println(Thread.currentThread().getName() + "开始运行：" + LocalTime.now());
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                e.printStackTrace();
            } finally {
                System.out.println(Thread.currentThread().getName() + "运行结束：" + LocalTime.now());
                doneSignal.countDown();
            }
        }
    }

}
```

运行时应观察到：两个 Worker 在开工信号后开始，`main` 在两项工作都结束后打印结束信息。具体时间戳和 Worker 之间的输出顺序不固定。`finally` 中的计数只报告“这一项已结束”；即使工作失败，计数也会减少，因此结果或异常还需要单独保存，或者交给 `Future` 等工具。

## 计数怎样控制等待线程

### state 直接保存剩余次数

内部 Sync 继承 AQS。共享获取在 state 为零时成功，否则失败；释放则用 CAS 把非零计数减一，只有刚刚降到零的线程报告需要传播通知。

```java
private static final class Sync extends AbstractQueuedSynchronizer {
    private static final long serialVersionUID = 4982264981922014374L;
    Sync(int count) {
        setState(count);
    }
    int getCount() {
        return getState();
    }
    protected int tryAcquireShared(int acquires) {
        return (getState() == 0) ? 1 : -1;
    }
    protected boolean tryReleaseShared(int releases) {
        for (;;) {
            int c = getState();
            if (c == 0)
                return false;
            int nextc = c-1;
            if (compareAndSetState(c, nextc))
                return nextc == 0;
        }
    }
}
```

到零后再次 countDown 不会产生负数，也不会重新关闭门闩。构造器拒绝负计数，零计数则使 await 可以立即通过。

### await 等待计数归零

await 调用 AQS.acquireSharedInterruptibly。它响应等待线程的中断；计数尚未归零时排队，归零后等待者通过共享获取继续传播通知。与信号量不同，等待者通过门闩不会把计数重新加回去或消耗一份许可。

带超时 await 返回 false 只说明等待者没有在预算内看到归零，不会自动取消仍在运行的工作。无超时等待则可能因为某项工作永不结束、遗漏 countDown 或约定次数错误而一直等待。

这也解释了为什么示例要把 `doneSignal.countDown()` 放在 `finally` 中。它报告的是 Worker 已经走到结束路径，避免一个已退出的 Worker 永远留下未完成的计数。若 Worker 根本没有被成功启动，则仍需由启动逻辑处理那次没有发生的工作，`finally` 无法替它执行。

## 完成信号同时发布先前的写入

countDown 之前的动作，happens-before 另一个线程从相应 await 成功返回后的动作。因此可以先保存结果，再 countDown，最后在 await 成功后读取；不能先 countDown 再写结果并假定这部分写入也被同一个信号发布。

需要重复的多轮同步时，CountDownLatch 的一次性语义通常不合适，应根据参与者和阶段规则选择其他同步工具。不要通过反射重置其内部 state 来模拟新一轮。

## 资料来源

- [CountDownLatch：一次性计数、超时与内存一致性](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html)
- [AQS 的共享获取与通知传播](/aqs/)
