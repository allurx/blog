---
title: CAS
date: 2019-07-23
categories:
- Java
- Concurrent
- CAS
tags:
- Java
- Concurrent
- CAS
---

# 概述

在并发场景下通常会有多个线程访问某个共享资源，此时我们能够立马想到的解决方法是给某个方法加上synchronized关键字，这样就能够保证同一时刻只有一个线程访问这个共享变量。但是synchronized属于独占锁，而独占锁是一种悲观锁，会导致其它正在尝试访问同步资源的线程挂起，等待持有锁的线程释放锁，在并发量很大的情况下性能表现很差。而另一个更加有效的锁就是乐观锁。所谓乐观锁就是，每次访问共享资源时不加锁而是假设没有冲突而去完成某项操作，只会在最后修改共享资源时判断一下有没有其它线程修改过这个共享资源，如果有修改的话就重新尝试，直到成功为止。本文要介绍的CAS就是一种乐观锁实现方式。

<!-- more -->

# CAS原理

CAS全称为Compare and Swap，意为比较然后交换的意思。那么比较的是什么？交换的又是什么呢？它究竟是怎么通过无锁的方式去更新共享资源的呢？在之前我们先了解一下CAS中的几个概念：

* 内存值
* 预期值
* 更新值

**执行CAS操作时，如果当前内存值和预期的值一致的话就将内存值原子性的设置为更新值，否则的话不断地尝试直到成功为止，CAS的本质是通过死循环实现的**。
例如线程A和线程B此时都在尝试修改变量`a=1`的值加一。此刻线程A开始执行，获取变量a在内存中的值为1，接下来即将执行CAS操作，此时cpu进行调度B线程获取执行权，依旧先获取变量a此刻在内存中的值为1，执行CAS操作，将预期值1与内存值1做比较发现是相同的，CAS成功，将变量a自增，此时内存中的a值为2，线程B运行结束退出。cpu调度线程A获取执行权，继续执行上一步的CAS操作，将预期值1与内存值2做比较发现不相同（被线程B修改了），CAS失败，继续下一次循环，继续获取变量a在内存中的值为2，执行CAS操作，此时预期值2和内存值2相同，CAS成功，将变量a自增，最终变量a的值变为3。

# Unsafe

现在我们知道CAS本质上是通过不断地比较变量此刻在内存中的值与预期的值是否一致来更新变量的。而提供比较更新这个操作是通过jdk中的Unsafe类来实现的，这个类里面的绝大多数方法都是native方法，我们还是以上面的那个自增的例子来看一下Unsafe是怎么实现的

```java
public final native boolean compareAndSwapInt(Object var1, long var2, int var4, int var5);

public native int getIntVolatile(Object var1, long var2);

public final int getAndAddInt(Object var1, long var2, int var4) {
    int var5;
    do {
        var5 = this.getIntVolatile(var1, var2);
    } while(!this.compareAndSwapInt(var1, var2, var5, var5 + var4));

    return var5;
}
```

利用CAS实现自增用到了以上两个方法，第一个compareAndSwapInt方法是jvm底层实现的native方法，它保证了在执行比较以及交换时的原子性，如果预期值和内存值一致，这个方法会将变量修改为更新值，然后返回true，否则的话直接返回false。getIntVolatile方法保证拿到的变量是内存中的最新的值。而getAndAddInt方法我们可以发现它通过一个while死循环，不断地从内存中获取到变量的最新值，然后将这个最新值（预期值）通过compareAndSwapInt方法进行CAS操作。

# 例子

下面我们通过CAS来实现递增方法

```java
package com.example.demo;

import sun.misc.Unsafe;

import java.lang.reflect.Constructor;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * @author zyc
 */
public class DemoApplication {

    private static Unsafe unsafe;
    private static volatile int value;
    private static long valueOffset;
    private static AtomicInteger atomicInteger = new AtomicInteger();

    static {
        Constructor<?> constructor = Unsafe.class.getDeclaredConstructors()[0];
        constructor.setAccessible(true);
        try {
            unsafe = (Unsafe) constructor.newInstance();
            valueOffset = unsafe.staticFieldOffset(DemoApplication.class.getDeclaredField("value"));
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void main(String[] args) throws Exception {
        Thread thread1 = new Thread(() -> casIncrement(1000));
        Thread thread2 = new Thread(() -> casIncrement(10000));
        Thread thread3 = new Thread(() -> casIncrement(100000));
        thread1.start();
        thread2.start();
        thread3.start();
        thread1.join();
        thread2.join();
        thread3.join();
        System.out.println(value);
        System.out.println("cas失败次数: " + atomicInteger.get());
    }

    private static void casIncrement(int n) {
        for (int i = 0; i < n; i++) {
            for (; ; ) {
                // int expect = unsafe.getIntVolatile(DemoApplication.class, valueOffset);
                if (unsafe.compareAndSwapInt(DemoApplication.class, valueOffset, value, value + 1)) {
                    break;
                }
                atomicInteger.getAndIncrement();
            }
        }
    }

}
```

控制台输出

```
111000
cas失败次数: 1490
```

在上面的例子中，开启三个线程执行increment方法，这个increment方法的作用是将共享变量value自增n次，每次自增前获取内存中最新的value值，由于这里value是被volatile修饰的，能够保证每个线程拿到的都是内存中最新的值，所以就没有通过Unsafe的getIntVolatile方法来获取内存中最新的值了。然后通过compareAndSwapInt方法将value与内存中的值进行CAS操作，成功则自增，失败的话则重新获取内存中的值再次进行CAS操作，直到成功为止。这里还通过AtomicInteger统计了CAS失败的次数，发现共享资源的竞争还是很激烈的。

# 总结

CAS本质上是通过死循环不断地比较当前获取到的变量值（期望值），通过CAS与内存中变量最新的值（内存值）作比较，只要一致的话就设置为新的值（更新值），否则的话重新获取再次比较直到CAS成功为止。