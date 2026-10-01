---
title: Thread例子
date: 2019-07-12
updated: 2026-10-01
id: 2019-07-12-java-threads-ordered-letters
tags:
  - Java
  - Thread
  - Thread例子
domain: Java
---

## 核心结论

三个线程轮流打印 `ABC`，关键是把“检查轮次、输出、推进轮次”放在同一个同步边界中。仅用 `volatile` 保证可见性不能一般性地替代互斥。条件等待可以让暂时无权输出的线程休眠，避免无限忙等占用 CPU。

## 问题与适用范围

本文用共享监视器演示固定次数的线程协作，输出十行 `ABC` 后结束。每个线程在 `while` 中检查自己的轮次，完成一次输出后通知等待者；中断时结束整组协作，主线程等待三个线程退出。这个例子用于理解同步规则，不是生产任务调度框架。

<!-- more -->

## 三个线程循环打印 ABC

保存为 `OrderedLetters.java`，编译运行后打印十行 `ABC`。三个线程共享 `lock` 和轮次，等待时释放监视器；每次输出和轮次更新都在持锁期间完成。

```java
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

使用 `while` 而非 `if` 检查轮次，因为一次唤醒不保证轮次属于当前线程。原来的无限自旋示例虽然在固定三个写入者的协议下可以轮转，却长期占用 CPU，也没有结束条件；这里以有限输出和条件等待表达同一协作目标。中断时设置共享取消标记并通知其他等待者，避免它们等待一个已经退出的参与者。

## 资料来源

- [Object.wait：条件检查与虚假唤醒](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#wait())
- [JLS 17：监视器与线程间动作](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html)
