---
title: CAS
date: 2019-07-23
updated: 2026-10-02
tags:
  - Java
  - Concurrent
  - CAS
domain: Java
---

CAS 原子地完成一次“比较预期值并更新”的操作，失败时由调用方决定是否重试。自增循环必须从同一次读取的值计算预期值和更新值；`volatile` 的可见性不能把两次读取合并成一个快照。CAS 也不天然比锁更快，高竞争下重试会消耗 CPU。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/sun/misc/Unsafe.java) 的 Unsafe 实现解释 CAS 重试，再用公开的 AtomicInteger 演示共享计数。单变量 CAS 不自动解决多个字段的一致性，应用应使用公开原子类，而不是直接依赖 Unsafe。


## CAS原理

CAS全称为Compare and Swap，意为比较然后交换的意思。那么比较的是什么？交换的又是什么呢？它究竟是怎么通过无锁的方式去更新共享资源的呢？在之前我们先了解一下CAS中的几个概念：

* 内存值
* 预期值
* 更新值

**一次 CAS 操作在当前值等于预期值时原子地设置更新值，否则报告失败。循环重试属于调用者实现的更新协议，不是 CAS 操作本身。**
例如线程A和线程B此时都在尝试修改变量`a=1`的值加一。此刻线程A开始执行，获取变量a在内存中的值为1，接下来即将执行CAS操作，此时cpu进行调度B线程获取执行权，依旧先获取变量a此刻在内存中的值为1，执行CAS操作，将预期值1与内存值1做比较发现是相同的，CAS成功，将变量a自增，此时内存中的a值为2，线程B运行结束退出。cpu调度线程A获取执行权，继续执行上一步的CAS操作，将预期值1与内存值2做比较发现不相同（被线程B修改了），CAS失败，继续下一次循环，继续获取变量a在内存中的值为2，执行CAS操作，此时预期值2和内存值2相同，CAS成功，将变量a自增，最终变量a的值变为3。

## Unsafe

OpenJDK 8u202-b08 使用 Unsafe 提供底层比较更新操作。getAndAddInt 在 CAS 之外增加重试循环；应用直接使用公开的原子类即可。

```java
public final native boolean compareAndSwapInt(Object o, long offset,
                                              int expected, int x);

public native int getIntVolatile(Object o, long offset);

public final int getAndAddInt(Object o, long offset, int delta) {
    int v;
    do {
        v = getIntVolatile(o, offset);
    } while (!compareAndSwapInt(o, offset, v, v + delta));
    return v;
}
```

利用CAS实现自增用到了以上两个方法，第一个compareAndSwapInt方法是jvm底层实现的native方法，它保证了在执行比较以及交换时的原子性，如果预期值和内存值一致，这个方法会将变量修改为更新值，然后返回true，否则的话直接返回false。getIntVolatile方法保证拿到的变量是内存中的最新的值。而getAndAddInt方法我们可以发现它通过一个while死循环，不断地从内存中获取到变量的最新值，然后将这个最新值（预期值）通过compareAndSwapInt方法进行CAS操作。

## 例子

下面的完整例子只使用标准库。三个线程分别自增 1000、10000、100000 次，结束后的值应为 111000；失败次数会随调度变化。

```java
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

`expected` 保存一次读取的快照，更新值从这个快照计算。比较失败时重新读取，不能分别读取共享值来拼出预期值和更新值。业务只需要自增时，直接调用 `incrementAndGet()` 即可；这里保留循环是为了展示协议。

## 总结

CAS 提供一次原子比较更新；自增算法在失败后重新读取并计算。是否重试、如何取消以及如何处理高竞争，仍由调用者的协议决定。

## 资料来源

- [AtomicInteger：compareAndSet 与原子更新](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)
- [java.util.concurrent.atomic：原子访问契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html)
