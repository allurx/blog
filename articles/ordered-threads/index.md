---
title: 三个线程怎样按顺序循环打印 ABC
date: 2019-07-12
updated: 2026-10-03
tags:
  - Java
  - Thread
  - Thread例子
domain: Java
---

启动 A、B、C 三个线程，并不保证它们按启动顺序运行。即便第一次碰巧打印出 `ABC`，下一轮也可能乱序。要连续打印十行 `ABC`，程序需要自己保存“现在轮到谁”，让每个线程在输出前遵守这条规则。

本文用共享监视器演示固定次数的线程协作，输出十行 `ABC` 后结束。每个线程在 `while` 中检查自己的轮次，完成一次输出后通知等待者；中断时结束整组协作，主线程等待三个线程退出。这个例子用于理解同步规则，不是生产任务调度框架。


示例目标为 Java 25，只依赖 JDK 标准库。保存为 OrderedLetters.java 后执行 `javac -encoding UTF-8 -d out OrderedLetters.java`、`java -cp out io.allurx.OrderedLetters`，预期完整输出十行 ABC。它验证固定轮次协议，不依赖线程启动先后或优先级。

本文完整用法示例已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译并运行。

## 先把输出顺序写成共享状态

用 `turn = 0` 表示轮到 A，1 表示 B，2 表示 C。输出一次后把它推进到下一轮，C 再推进到 A。线程尚未轮到时调用 `wait()`，把监视器让给其他线程；推进轮次后调用 `notifyAll()`，让等待者重新检查。

这里必须把检查、输出和推进放进同一个 `synchronized` 块。`volatile` 只能解决特定读写的可见性，不能将这三个动作合并成不可分割的一次交接。

### 完整程序

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

### 沿着 A 到 B 的一次交接读代码

假设 B 先获得监视器，看到 `turn == 0`，便进入 `wait()`。A 随后获得监视器，打印 A，将 `turn` 改成 1，再通知等待者。通知不会把锁立即交给 B：A 先退出同步块，B 才有机会重新获取监视器并检查轮次。

这就是 `while` 的作用。B 可能因通知或虚假唤醒返回，C 也可能抢先获得监视器；每个线程都要重新确认轮次，不能把“被唤醒”当成“获准输出”。

## 为什么十轮之后能结束

持有 lock 时，turn 只取 0、1、2，并且只有匹配自己 order 的线程输出。输出与推进 turn 在同一临界区完成，避免另一个线程在二者之间把同一轮次再次消费。C 输出后换行并把 turn 改回 0，十轮结束后三个线程自然退出。

正常路径中，每个线程恰好输出十次，C 的第十次输出完成最后一行。主线程的 `join()` 只负责等三位参与者退出，轮次仍由共享状态决定。

中断路径则需要共同结束：如果 B 在等待中退出，而 A、C 继续等下一轮 B，就无法再推进。代码因此在捕获中断时设置 `cancelled` 并通知所有等待者。其他线程取回监视器后检查这个标记，及时退出，而不是等待一个已经离开的参与者。

## 资料来源

- [Object.wait：条件检查与虚假唤醒](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#wait())
- [JLS 17：监视器与线程间动作](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html)
