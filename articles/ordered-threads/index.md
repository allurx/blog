---
title: "Thread 例子"
date: 2019-07-12
updated: 2026-10-03
tags:
  - Java
  - Thread
  - Thread例子
domain: Java
---

三个线程轮流打印 `ABC`，关键是把“检查轮次、输出、推进轮次”放在同一个同步边界中。仅用 `volatile` 保证可见性不能一般性地替代互斥。条件等待可以让暂时无权输出的线程休眠，避免无限忙等占用 CPU。

本文用共享监视器演示固定次数的线程协作，输出十行 `ABC` 后结束。每个线程在 `while` 中检查自己的轮次，完成一次输出后通知等待者；中断时结束整组协作，主线程等待三个线程退出。这个例子用于理解同步规则，不是生产任务调度框架。


示例目标为 Java 25，只依赖 JDK 标准库。保存为 OrderedLetters.java 后执行 `javac -encoding UTF-8 -d out OrderedLetters.java`、`java -cp out io.allurx.OrderedLetters`，预期完整输出十行 ABC。它验证固定轮次协议，不依赖线程启动先后或优先级。

本文完整用法示例已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译并运行。

## 三个线程循环打印 ABC

保存为 `OrderedLetters.java`，编译运行后打印十行 `ABC`。三个线程共享 `lock` 和轮次，等待时释放监视器；每次输出和轮次更新都在持锁期间完成。

```java
package io.allurx;

/**
 * @author allurx
 */
public class OrderedLetters {

    private static final Object lock = new Object();
    private static int turn;
    private static boolean cancelled;

    public static void main(String[] args) throws InterruptedException {
        Thread first = new Thread(() -> print("A", 0));
        Thread second = new Thread(() -> print("B", 1));
        Thread third = new Thread(() -> print("C", 2));
        first.start();
        second.start();
        third.start();

        first.join();
        second.join();
        third.join();
    }

    private static void print(String letter, int order) {
        for (int i = 0; i < 10; i++) {
            synchronized (lock) {
                while (!cancelled && turn != order) {
                    try {
                        lock.wait();
                    } catch (InterruptedException exception) {
                        cancelled = true;
                        lock.notifyAll();
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
                if (cancelled) {
                    return;
                }

                System.out.print(letter);
                if (order == 2) {
                    System.out.println();
                }
                turn = (turn + 1) % 3;
                lock.notifyAll();
            }
        }
    }
}
```

使用 `while` 而非 `if` 检查轮次，因为一次唤醒不保证轮次属于当前线程。若改成无限轮询，即使某个固定写入者协议能够轮转，仍会持续占用 CPU，也缺少完成条件。这里的有限次数与条件等待明确了开始、交接和退出。中断时设置共享取消标记并通知其他等待者，避免它们等待一个已经退出的参与者。

## 用不变量判断连续交接

持有 lock 时，turn 只取 0、1、2，并且只有匹配自己 order 的线程输出。输出与推进 turn 在同一临界区完成，避免另一个线程在二者之间把同一轮次再次消费。C 输出后换行并把 turn 改回 0，十轮结束后三个线程自然退出。

notifyAll 不指定下一个线程一定获得 CPU；被唤醒者重新检查 while，只有轮次匹配者继续。如果等待中的线程被中断，共享 cancelled 让其他参与者也退出，避免等待一个已经离开的参与者。主线程 join 的目的则是等完整协议结束，不承担轮次分配。

## 资料来源

- [Object.wait：条件检查与虚假唤醒](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#wait())
- [JLS 17：监视器与线程间动作](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html)
