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

两个线程都想把计数器加一。它们恰好都读到 `1`，各自算出 `2`，再分别写回，最终计数就少了一次。问题发生在“读取”与“写回”之间：写入者不知道自己读到的值是否已经被别人改过。

CAS（compare-and-set）把这个检查与写入合成一次原子操作：当前值仍等于预期值时才更新，否则报告失败。失败的线程重新读取并计算，就有机会在别人已经完成的更新之后继续累加。

本文用计数器解释重试过程，再讨论一次原子更新能保护多大的范围。完整程序使用 Java 25 标准库，可在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。

## 一次比较更新如何避免覆盖别人刚写入的值

假设值为 1。A 读取 1 后暂停，B 也读取 1，把它 CAS 为 2；A 再用预期值 1 更新时会失败，因为当前值已经是 2。A 重新读取 2，计算新值 3，再尝试 CAS，才不会覆盖 B 的更新。

这段推演依赖更新值与预期值来自同一次读取。若分别调用两次 get 拼出 expected 和 update，第二次读取可能看到别人的新值，协议就不再等价于“在我读取的那个值上加一”。volatile 的可见性不能把两个读取合并为同一个快照。

## 把比较更新放进重试循环

### 完整计数程序

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

### 结果为什么应当是 111000

三个线程分别执行 1000、10000、100000 次自增，每轮都在 CAS 成功后才退出内层循环。主线程用 `join` 等待它们完成，因此最终结果应当为 `111000`。CAS 失败次数随调度变化；统计失败本身也引入额外原子更新，所以它不能作为无扰动的性能测量。

失败时循环重新读取，不复用旧 expected。业务只需要标准自增时，直接使用 incrementAndGet；这里保留显式循环是为了观察比较更新的协议。

## CAS 不自动提供的保证

| 问题 | CAS 的边界 |
| --- | --- |
| 多字段一致性 | 一次 CAS 只更新一个位置，多个字段仍需共同协议 |
| ABA | 值先变走又变回时，单纯相等比较不能识别中间历史 |
| 公平性与饥饿 | 某次 CAS 成功不保证每个竞争者都能及时成功 |
| 取消与时限 | 无限重试循环必须另行定义停止条件 |
| 算术溢出 | 原子性不会阻止 int 自增越界 |

### 值相同，是否就代表状态没有变过

假设线程 A 读取一个链表头节点后暂停。线程 B 移除这个节点，做了一些修改，又让头部指回同一个节点。A 恢复后比较引用，仍然相等，却无法由此证明节点的关联关系没有变化。这就是 ABA 问题的关键：比较只看到现在的值，业务可能还依赖中间没有发生过某些变化。

ABA 是否有害取决于业务。只关心当前数值的计数器，不一定需要记录每一次往返变化；依赖节点关系的算法则可能需要版本戳。需要版本时，应让版本和状态参与同一次原子比较。

## 什么时候直接使用锁更清楚

多个字段需要一起验证和修改，或失败后要维护复杂关系时，一把锁可能更容易表达正确边界。CAS 在高竞争下反复失败也会消耗 CPU；是否更快需要同负载、同硬件和同语义下测量，不能把“无锁”当作通用性能结论。

计数这个用例已经有 `AtomicInteger.incrementAndGet()`。显式 CAS 循环适合用来理解机制，或表达标准方法没有直接提供的更新条件；实际实现仍可优先采用公开原子类提供的操作。

## 资料来源

- [AtomicInteger：compareAndSet 与原子更新](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)
- [java.util.concurrent.atomic：原子操作与内存语义](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html)
