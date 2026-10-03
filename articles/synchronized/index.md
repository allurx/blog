---
title: "synchronized 用法"
date: 2019-07-11
updated: 2026-10-03
tags:
  - Java
  - Thread
  - Synchronized
domain: Java
---

synchronized 以一个具体对象的监视器建立互斥。判断两个操作会不会互相等待，关键是它们竞争的是否为同一个监视器，而不是方法都叫 synchronized，或者共享变量看起来属于同一个类。

本文按 Java SE 25 的语言规则比较常见写法，用一个完整自增程序验证静态共享状态的保护。示例只依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下运行。

## 五种写法最终锁住哪个对象

| 写法 | 使用的监视器 |
| --- | --- |
| static synchronized 方法 | 声明该方法的类的 Class 对象 |
| synchronized 实例方法 | 调用目标 this |
| synchronized(SomeClass.class) | 指定的 Class 对象 |
| synchronized(this) | 当前实例 |
| synchronized(lock) | 执行时 lock 引用指向的对象 |

监视器属于对象，不属于变量名。两个变量指向同一个对象，就竞争同一监视器；两个不同实例即使来自同一类，也有不同的 this 监视器。普通方法或使用其他锁的代码，不会因为旁边存在一个同步方法就自动被阻止。

## 静态共享计数由类监视器保护

下面两个 Worker 操作同一个静态 n，increase 使用类监视器，把读取、加一和写回合并到同一个互斥区间。main 用 join 等待两个工作线程结束后再读取结果。

保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`：

```java
package io.allurx;

public class DemoApplication {

    private static int n = 0;

    static synchronized void increase() {
        n++;
    }

    public static void main(String[] args) throws Exception {
        Thread thread1 = new Worker();
        Thread thread2 = new Worker();
        thread1.start();
        thread2.start();
        thread1.join();
        thread2.join();
        System.out.println(n);
    }

    static class Worker extends Thread {

        @Override
        public void run() {
            for (int i = 0; i < 1000; i++) {
                increase();
            }
        }
    }
}
```

实测输出 2000。这里依赖两个不同关系：监视器避免 n++ 丢失更新，join 确保读取发生在工作线程结束之后。只看到某次结果恰好是 2000，不足以证明一个去掉同步的变体也正确。

## 同步块可以表达相同的互斥边界

上面 increase 的等价保护范围可以写成下面的方法片段：

```java
static void increase() {
    synchronized (DemoApplication.class) {
        n++;
    }
}
```

实例方法中的 synchronized(this) 则等价于对当前实例同步。选择块式写法可以缩小实际需要保护的区间，但缩小前必须确认检查、修改和关联不变量仍在同一个边界内，不能只为了减少代码行把检查移出去。

## 两个实例不能各自保护同一份静态状态

假设静态 n 仍共享，却由实例 A 和实例 B 的 synchronized 实例方法分别自增。线程 1 可以持有 A，线程 2 同时持有 B；两个临界区并不互斥，因此复合更新仍可丢失。

同理，实例字段 lock 即使声明为 final，也只保证引用不改指向，不代表不同实例共享了同一个锁。若希望用专门锁对象保护静态状态，应明确共享该对象；若状态属于各自实例，则各实例锁通常更符合职责。

## 可见性、重入与释放边界

同一监视器上的解锁 happens-before 后续成功加锁，所以锁既提供互斥，也发布此前写入；共享字段的相关访问仍须遵循同一协议。synchronized 可重入，拥有者再次进入同一监视器不会与自己死锁，退出时对应减少持有层数。

正常返回或异常离开同步范围时都会释放监视器，但不回滚已经修改的业务数据。锁保护的数据如果需要事务式一致性，仍应安排合适的更新顺序与失败处理。

wait 会暂时释放调用目标的监视器，返回前重新取得；sleep 不释放已持有监视器。synchronized 不保证公平，争用监视器的等待也不是可中断获取 API。需要超时、可中断获取或多个条件队列时，再评估 [ReentrantLock](/reentrant-lock/)。

## 资料来源

- [JLS 14.19：synchronized 语句](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.19)
- [JLS 17：监视器与 happens-before](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html)
