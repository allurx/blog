---
title: "LockSupport 源码分析"
date: 2019-07-25
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - Lock
  - LockSupport
domain: Java
---

LockSupport 为每个线程关联至多一个许可。unpark 提供许可，park 消耗许可或等待；许可可以先于停车到达，但不会累计成消息数量。正确用法始终围绕一个业务条件循环检查，不能把 park 返回当作条件已经满足的证明。

本文先用许可模型解释返回原因，再给出两阶段协作程序，最后说明 blocker 的诊断用途。完整示例只依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下运行；内部背景参考 [OpenJDK 8u202-b08 LockSupport](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/LockSupport.java)。

## 一个许可，决定能否免于等待

| 发生的动作 | 随后的观察 |
| --- | --- |
| 先 unpark，再 park | park 可以消费已有许可并返回 |
| 连续两次 unpark | 仍至多保留一个许可 |
| 第二次 park 前没有新许可 | 可能等待，但仍可能中断或虚假返回 |

unpark 可以在线程已启动但尚未 park 时发出，因此比依赖“等对方先停住”的协议更容易组合。不过对尚未启动线程的 unpark 不能作为可靠许可交付方式，API 不保证这种用法。

park 还可能因中断或虚假唤醒返回，不会像 wait 那样抛出 InterruptedException，也不会清除中断标记。若调用者不处理退出条件，再次 park 可能立即返回，形成忙循环。

## 用共享条件保护两次通知

phase 保存业务进度，volatile 读写发布条件。Worker 先等待 phase 至少为 1，再等待至少为 2；main 修改条件后再 unpark。即使两次更新发生在 Worker 第一次运行之前，它也能依次通过两个条件，不需要积累两个许可。

保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`：

```java
package io.allurx;

import java.util.concurrent.locks.LockSupport;

/**
 * @author allurx
 */
public class DemoApplication {

    private static volatile int phase;

    public static void main(String[] args) throws InterruptedException {
        Thread worker = new Thread(() -> {
            for (int expected = 1; expected <= 2; expected++) {
                while (phase < expected) {
                    if (Thread.currentThread().isInterrupted()) {
                        return;
                    }
                    LockSupport.park(DemoApplication.class);
                }
                System.out.println("已观察到阶段 " + expected);
            }
        }, "worker");
        worker.start();

        try {
            Thread.sleep(100);
            phase = 1;
            LockSupport.unpark(worker);
            Thread.sleep(100);
            phase = 2;
            LockSupport.unpark(worker);
            worker.join();
        } finally {
            worker.interrupt();
        }
    }
}
```

实测依次输出“已观察到阶段 1”和“已观察到阶段 2”。main 的 sleep 只拉开观察间隔，正确性依赖 phase 与检查循环；换成不可见的普通共享变量，unpark 也不能替它自动补齐完整的业务状态协议。

若业务要消费两条独立消息，应在队列或计数中保存消息，不能用两次 unpark 代替。这里的条件表示阶段进度，含义与消息数量不同。

## 定时等待也要区分预算与时刻

| 方法 | 时间含义 |
| --- | --- |
| park | 不主动设置超时 |
| parkNanos(nanos) | 相对等待纳秒数，非正值不等待 |
| parkUntil(deadline) | 从 Unix 纪元起算的绝对毫秒截止点 |

所有这些方法都可能提前返回，超时后也不保证马上获得 CPU。需要相对总预算时通常使用单调时钟维护剩余时间，循环重新检查；墙上时间可能调整，不能把 parkUntil 的截止时间直接当作单调计时。

## blocker 是诊断信息，不是锁

带 blocker 的重载把等待原因关联到线程，供 getBlocker 或诊断工具观察。在所引 Java 8 实现中，它先设置 Thread.parkBlocker，调用 Unsafe.park，返回后清除字段。

这个对象不因此获得监视器语义：park 不要求 synchronized(blocker)，也不会释放已经持有的监视器。getBlocker 的结果只是瞬时观察，线程可能已返回，不能把它当作另一个业务状态变量。

应用通常直接使用 ReentrantLock、Condition、CountDownLatch 等成熟同步器。自己组合 LockSupport 时，应先写清条件如何发布、谁负责通知、怎样处理中断以及何时退出，再考虑停车机制。

## 资料来源

- [LockSupport：许可、虚假唤醒、中断与 blocker](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/LockSupport.html)
- [OpenJDK 8u202-b08 LockSupport 的完整实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/locks/LockSupport.java)
