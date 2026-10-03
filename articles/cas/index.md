---
title: CAS
date: 2019-07-23
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - CAS
domain: Java
---

CAS 原子地比较当前位置与预期值，相等时写入新值，不相等时报告失败。它只完成一次比较更新；是否重试、怎样重新读取、能否取消，属于调用者的协议。

本文用计数器说明 CAS 循环需要维护的一致快照，再区分单变量原子性与更大的业务不变量。完整程序使用 Java 25 标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）运行；底层命名参考 [OpenJDK 8u202-b08 Unsafe](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/sun/misc/Unsafe.java)，业务无需直接依赖内部 Unsafe。

## 一次比较更新如何避免覆盖别人刚写入的值

假设值为 1。A 读取 1 后暂停，B 也读取 1，把它 CAS 为 2；A 再用预期值 1 更新时会失败，因为当前值已经是 2。A 重新读取 2，计算新值 3，再尝试 CAS，才不会覆盖 B 的更新。

这段推演依赖更新值与预期值来自同一次读取。若分别调用两次 get 拼出 expected 和 update，第二次读取可能看到别人的新值，协议就不再等价于“在我读取的那个值上加一”。volatile 的可见性不能把两个读取合并为同一个快照。

## 用 AtomicInteger 实现并核对计数

保存为 CasCounter.java，执行 `javac -encoding UTF-8 -d out CasCounter.java`、`java -cp out io.allurx.CasCounter`：

```java
package io.allurx;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * @author allurx
 */
public class CasCounter {

    private static final AtomicInteger value = new AtomicInteger();
    private static final AtomicInteger failures = new AtomicInteger();

    public static void main(String[] args) throws InterruptedException {
        Thread first = new Thread(() -> increment(1000));
        Thread second = new Thread(() -> increment(10000));
        Thread third = new Thread(() -> increment(100000));
        first.start();
        second.start();
        third.start();

        first.join();
        second.join();
        third.join();
        System.out.println(value.get());
        System.out.println("CAS 失败次数: " + failures.get());
    }

    private static void increment(int count) {
        for (int i = 0; i < count; i++) {
            while (true) {
                int expected = value.get();
                if (value.compareAndSet(expected, expected + 1)) {
                    break;
                }
                failures.incrementAndGet();
            }
        }
    }
}
```

三个线程分别执行 1000、10000、100000 次自增，join 后实测为 111000。CAS 失败次数随调度变化；统计失败本身也引入额外原子更新，所以它不是无扰动的性能测量。

失败时循环重新读取，不复用旧 expected。业务只需要标准自增时，直接使用 incrementAndGet；这里保留显式循环是为了观察比较更新的协议。

## CAS 不自动提供的保证

| 问题 | CAS 的边界 |
| --- | --- |
| 多字段一致性 | 一次 CAS 只更新一个位置，多个字段仍需共同协议 |
| ABA | 值先变走又变回时，单纯相等比较不能识别中间历史 |
| 公平性与饥饿 | 某次 CAS 成功不保证每个竞争者都能及时成功 |
| 取消与时限 | 无限重试循环必须另行定义停止条件 |
| 算术溢出 | 原子性不会阻止 int 自增越界 |

ABA 是否构成问题取决于业务：只关心当前数值的计数器，和需要证明节点未被移除再复用的链表协议，不具有相同要求。确实需要识别版本时，应把版本与状态纳入一次原子比较，不能先比较值再单独写一个版本号。

## 什么时候直接使用锁更清楚

多个字段需要一起验证和修改，或失败后要维护复杂关系时，一把锁可能更容易表达正确边界。CAS 在高竞争下反复失败也会消耗 CPU；是否更快需要同负载、同硬件和同语义下测量，不能把“无锁”当作通用性能结论。

Java 8 的 getAndAddInt 内部同样是读取、计算和 CAS 重试。现代业务使用公开原子类，让运行时选择适用实现；不要为了模仿历史底层代码而反射访问 Unsafe。

## 资料来源

- [AtomicInteger：compareAndSet 与原子更新](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)
- [java.util.concurrent.atomic：原子操作与内存语义](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html)
