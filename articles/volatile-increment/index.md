---
title: "volatile 变量自增为什么仍会丢失更新"
date: "2026-09-07"
updated: "2026-10-01"
domain: "Java 并发"
tags: ["Java", "volatile", "原子性"]
---

把共享计数器声明成 `volatile` 后，压力测试仍可能少计数。原因不在于写入完全不可见，而在于 `count++` 包含一次读取和一次写回；这两次访问之间，另一个线程仍能读到相同旧值并完成自己的更新。

本文讨论 Java 的单字段自增，代码使用 Java 8 起可用的标准 API。需要准确计数时，`AtomicInteger.incrementAndGet()` 提供原子读改写；需要维护多个字段之间的关系时，则要把整个判断和更新放进同一个同步边界。

## 两次可见写入仍可能覆盖彼此

两个线程分别执行一次 `count++`，初始值为 `0`，最终结果是否一定为 `2`？

它可以得到 `1`。下面的交错并不违反 `volatile` 的可见性规则：

| 顺序 | 线程 A      | 线程 B      |
| -- | --------- | --------- |
| 1  | 读取 `0`    |           |
| 2  |           | 读取 `0`    |
| 3  | 计算并写入 `1` |           |
| 4  |           | 计算并写入 `1` |

两次自增都执行完毕，但最终值只有 `1`。

Java Memory Model 规定，对某个 `volatile` 字段的写入 happens-before 后续线程对该字段的读取。这意味着后续读取能够观察到符合该同步顺序的值。[Java Language Specification 17.4](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html)

但 happens-before 解决的是操作之间的可见性和顺序，不等于把多个操作合并为不可分割的整体。

```java
count++;
```

语义上近似于：

```java
int current = count; // volatile read
int next = current + 1;
count = next;        // volatile write
```

单独的读取和写入受到 `volatile` 语义约束，但它们之间仍可插入其他线程的操作。

把 `value++` 改成 `++value` 不会改变这一点。前置和后置形式区别在表达式返回值，二者都要读取旧值并写回新值；“一行代码”不是原子性边界。

## 原子计数器提供完整的读改写

`AtomicInteger.incrementAndGet()` 的公共契约是原子递增并返回更新后的值。JVM 可以用硬件原子指令或等价机制实现，应用不需要假定内部一定存在一段 Java CAS 重试循环。[AtomicInteger 自增契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)

运行前提：Java 8+。

错误实现：

```java
public final class VolatileCounter {

    private volatile int value;

    public void increment() {
        value++;
    }

    public int get() {
        return value;
    }
}
```

正确的单计数器实现：

```java
import java.util.concurrent.atomic.AtomicInteger;

public final class AtomicCounter {

    private final AtomicInteger value = new AtomicInteger();

    public int increment() {
        return value.incrementAndGet();
    }

    public int get() {
        return value.get();
    }
}
```

在两个线程都结束之后读取最终值：如果它们各调用一百万次，`VolatileCounter` 的结果可能小于两百万；`AtomicCounter` 则不会因为并发覆盖而丢失自增。

上述“可能少于两百万”是竞争结果，不是每次运行都必须出现的输出。若一次测试恰好得到两百万，只能说明那次调度没有暴露丢失，不能证明 `volatile` 自增正确。还应通过 `join()` 等手段等待全部写线程完成，再评价最终计数；中途读取值本来就可能尚未达到终值。

## 同步范围应跟随不变量

`volatile` 适合停止标志或整体替换的配置引用等场景。它不会为引用指向的整个可变对象自动建立一致性，也不会阻止多个线程同时执行检查。

例如，下面的代码即使 `stock` 是 `AtomicInteger`，也不能保证库存不为负：

```java
if (stock.get() > 0) {
    stock.decrementAndGet();
}
```

两个线程可以同时通过判断，然后分别扣减。需要把条件和更新放入同一个原子协议；对于单字段，可以使用 CAS 循环：

```java
static boolean reserveOne(AtomicInteger stock) {
    while (true) {
        int current = stock.get();
        if (current <= 0) {
            return false;
        }
        if (stock.compareAndSet(current, current - 1)) {
            return true;
        }
    }
}
```

这里假定库存更新都遵守相同协议；CAS 失败后重新读取，不能继续使用旧快照。余额与版本号、状态与时间戳等多个字段必须一起变更时，分别使用原子类仍不够，应使用同一把锁、不可变状态整体替换或数据库事务等合适边界。

高并发统计可以考虑 `LongAdder`，但其并发 `sum()` 不是与所有更新形成单一线性化时刻的快照，不应替代需要精确条件判断的状态。锁、原子类与 `volatile` 的选择依据是所需语义，再在代表性负载下比较性能。
