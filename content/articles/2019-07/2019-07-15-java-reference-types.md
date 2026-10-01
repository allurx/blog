---
title: Java中的几种Reference
date: 2019-07-15
updated: 2026-10-01
id: 2019-07-15-java-reference-types
tags:
  - Java
  - Reference
domain: Java
---

## 核心结论

对象能否被回收取决于可达性。强引用、软引用、弱引用和虚引用参与不同的可达性判断；引用队列则用于观察相应引用对象的入队。`System.gc()`、内存压力或一次 `get()` 的结果都不能保证某个确定的回收时刻。

## 问题与适用范围

本文回答几种引用如何影响对象生命周期，保留原文实验和实现片段。软引用缓存的清理策略、GC 参数和实验时间依赖具体 JVM；它们不是 Java API 保证。示例用于观察引用行为，不能用一次运行结果证明对象一定会在某个时刻被回收，也不能把弱引用当作共享值自动清理的完整方案。

<!-- more -->

## StrongReference

StrongReference是强引用的意思，java中并没有定义这样一个类，它只是一个引用的概念。只要对象仍强可达，GC 就不能将其作为不可达对象回收，例如我们通过new出来的对象是存放在虚拟机的堆内存中的，此时定义的变量就是指向了堆内存中的这个对象，如果这个引用变量一直存活的话，那么gc就不会回收堆内存中的这个对象。

```java
public void test(){
	Object o = new Object();
}
```

假如我们程序中有以上一个方法，在该方法中定义了一个局部变量o指向了一个new Object()，这个Object被new出来后就会被存放在堆内存中，当该方法执行完毕后，局部变量o会被销毁，堆内存中的Object对象就没有引用指向它了，gc就会在适当的时候回收它，但如果这个o是我们定义的一个全局的变量，即便方法运行结束了，依旧指向了堆内存的Object对象，此时gc就不会回收它，一直占据着内存，随着项目越来越大，如果在业务上处理不当的话就会导致oom（OutOfMemoryError）。最典型的一个场景就是使用集合类当做对象的全局变量。随着集合对象包含的对象越来越多，很有可能会导致oom，因此，长期存活的容器或缓存应在不再需要元素时移除相应引用；不必机械地将所有局部变量设为 null。对象是否可回收取决于是否仍可达，回收时机由 GC 决定。例如在ArrayList的clear方法中就有这样的一段话

```java
public void clear() {
    modCount++;

    // clear to let GC do its work
    for (int i = 0; i < size; i++)
        elementData[i] = null;

    size = 0;
}
```

ArrayList中保存的对象最终都会存放在内部维护的名为elementData的Object[]数组中，clear 保留内部数组以便后续复用，因此需要把有效槽位设为 null，解除数组对原元素的引用。如果整个数组已经不可达，其元素不会仅因彼此仍有关联就永久存活；能否回收仍取决于是否存在其他可达路径。

## SoftReference

SoftReference是软引用的意思，具体的类定义为java.lang.ref.SoftReference，从类注释上我们可以知道如果一个对象只存在软引用并且当系统内存不够时，gc就会回收这个对象。软引用最常用于实现对内存敏感的缓存。软引用可以与引用队列（ReferenceQueue）联合使用，如果软引用所引用的对象被垃圾回收器回收，jvm就会把这个软引用加入到与之关联的引用队列中。

```java
package io.allurx;

import java.lang.ref.SoftReference;

/**
 * @author allurx
 */
public class DemoApplication {

    public static void main(String[] args) {
        SoftReference<Integer> softReferences = new SoftReference<>(128);
        new Thread(() -> {
            String s = "test";
            while (true) {
                s += s;
            }
        }).start();
        while (true) {
            Integer value = softReferences.get();
            if (value == null) {
                System.out.println(value);
                break;
            }
        }
    }
}
```

上面这个例子中SoftReference包含一个Integer类型的value（为128的原因是Integer类中缓存了-128-127的强引用的Integer对象，不会被gc回收），然后开启一个线程不断的拼接字符串，模拟oom的发生，接着主线程中不断的轮询SoftReference中的引用是否已经被回收，可以发现在运行几秒后子线程中发生OutOfMemoryError，随即SoftReference中的引用被gc清除，但是并不确定这个value是什么时候被gc的，只知道是发生OutOfMemoryError时被gc的，在网上查阅相关资料，SoftReference中的引用对象被清除的时机和**堆里的空闲内存大小**、**上次执行gc的时间**、**引用对象上次执行get方法的时间**、**jvm参数SoftRefLRUPolicyMSPerMB**这四个值有关。发生gc时是否清除SoftReference的公式如下：

```
clock - timestamp <= heap_free_at_last_gc * SoftRefLRUPolicyMSPerMB
```

* clock：上次执行gc的时间戳
* timestamp：SoftReference对象上次执行get方法的时间戳
* heap_free_at_last_gc：上次执行gc时剩余堆空间大小
* SoftRefLRUPolicyMSPerMB：jvm参数

此处是原文对历史 HotSpot 软引用策略的说明。按该不等式，成立表示引用年龄尚未超过估计保留窗口，不成立表示已超过窗口；它不能替代实际 GC 的完整决策。参数、计算公式与内存策略属于 JVM 实现细节，Java API 不保证跨版本使用该公式。

clock和timestamp变量定义在SoftReference源码中，看一下它的源码

```java
package java.lang.ref;

public class SoftReference<T> extends Reference<T> {

    static private long clock;

    private long timestamp;

    public SoftReference(T referent) {
        super(referent);
        this.timestamp = clock;
    }

    public SoftReference(T referent, ReferenceQueue<? super T> q) {
        super(referent, q);
        this.timestamp = clock;
    }

    public T get() {
        T o = super.get();
        if (o != null && this.timestamp != clock)
            this.timestamp = clock;
        return o;
    }
}
```

源码很简单，一个全局变量clock记录上次gc发生的时间，成员变量timestamp记录该软引用的对象上次执行get方法的时间，这里我们主要关注一下get方法的逻辑，`if (o != null && this.timestamp != clock)`这个判断的作用是如果引用对象还存活的话，那么就将引用对象的空闲时间重置为0，配合理解上面清除SoftReference的公式中的`clock - timestamp`，gc执行时间减去get方法调用时间就是该引用对象一直的空闲时间，只有当这个空闲时间超过一定的阈值时gc才会清除这个对象。所以get方法只要调用一次，就要和gc时间同步一下，以便下次gc运行时判断引用对象的空闲时间。

讨论了这么多，发现这个SoftReference并不是那么的好用，虽然jdk设计这个类的目的就是为了更好的实现缓存，但是实际操作中SoftReference被gc回收会受到很多其他因素的影响。下面对SoftReference做一个总结：

1. 系统发生OutOfMemoryError 前，Java 虚拟机一定会回收SoftReference对象，当然啦前提是这个SoftReference内的引用对象没有其他强引用指向它。
2. SoftReference中的引用对象被清除的时机和**堆里的空闲内存大小**、**上次执行gc的时间**、**引用对象上次执行get方法的时间**、**jvm参数SoftRefLRUPolicyMSPerMB**这四个值有关
3. 设置vm参数-XX:SoftRefLRUPolicyMSPerMB=0可以保证gc运行时立即清除SoftReference中的引用对象。
4.  Java提供SoftReference的期望是更好的实现缓存。

## WeakReference

WeakReference是弱引用的意思，具体的类定义为java.lang.ref.WeakReference，它和SoftReference的区别是当gc运行时，无论当前内存是否充足，只要WeakReference内的引用对象不存在其它强引用，它就会被gc被清除。看一下它的源码：

```java
package java.lang.ref;

public class WeakReference<T> extends Reference<T> {

    public WeakReference(T referent) {
        super(referent);
    }

    public WeakReference(T referent, ReferenceQueue<? super T> q) {
        super(referent, q);
    }

}
```

弱引用也可以与引用队列（ReferenceQueue）联合使用。GC 确定对象弱可达时会清除相应弱引用，并在同一时刻或随后把注册的弱引用对象入队；入队不是被引用对象的业务完成通知。下面看一个例子。

```java
package io.allurx;

import java.lang.ref.WeakReference;

/**
 * @author allurx
 */
public class DemoApplication {

    static Integer i = 129;

    public static void main(String[] args) throws Exception {
        Integer a = 130;
        WeakReference<Integer> weakReference1 = new WeakReference<>(128);
        WeakReference<Integer> weakReference2 = new WeakReference<>(i);
        WeakReference<Integer> weakReference3 = new WeakReference<>(a);
        System.out.println(weakReference1.get());
        System.out.println(weakReference2.get());
        System.out.println(weakReference3.get());
        System.gc();
        System.out.println(weakReference1.get());
        System.out.println(weakReference2.get());
        System.out.println(weakReference3.get());
    }

}

```

控制台输出

```java
128
129
130
null
129
130
```

当gc运行时WeakReference中不存在强引用的对象就被清除了

## PhantomReference

`PhantomReference` 用于跟踪对象进入虚可达状态后的处理，`get()` 始终返回 null，不能通过它重新取得对象。要观察入队，需要关联一个 `ReferenceQueue`；入队不提供确定的时间，也不是“已经完成任意外部资源清理”的保证。以下是原文展示的 Java 层接口片段，完整 GC 行为应按目标 JDK 的公共契约理解。

```java
package java.lang.ref;

public class PhantomReference<T> extends Reference<T> {

    public T get() {
        return null;
    }

    public PhantomReference(T referent, ReferenceQueue<? super T> q) {
        super(referent, q);
    }

}
```

`get()` 始终返回 null。构造器允许队列参数为 null，但这样的虚引用不会注册到引用队列；需要收到入队通知时应传入队列。下面保留原文的观察例子；装箱 Integer 的缓存范围、对象可达性和 GC 调度都会影响结果，不能保证一次 `System.gc()` 后必定出现同样输出。

```java
package io.allurx;

import java.lang.ref.PhantomReference;
import java.lang.ref.Reference;
import java.lang.ref.ReferenceQueue;

/**
 * @author allurx
 */
public class DemoApplication {

    public static void main(String[] args) throws InterruptedException {
        ReferenceQueue<Integer> referenceQueue = new ReferenceQueue<>();
        PhantomReference<Integer> phantomReference = new PhantomReference<>(128, referenceQueue);
        new Thread(() -> {
            Reference<?> reference;
            while (true) {
                if ((reference = referenceQueue.poll()) != null) {
                    System.out.println(reference+":被gc回收了");
                    break;
                }
            }
        }).start();
        Thread.sleep(2000);
        System.gc();
    }
}
```

开启一个子线程不断的轮询PhantomReference中的ReferenceQueue查看引用对象是否被gc回收了，主线程睡眠2秒后，调用gc方法，控制台输出了PhantomReference被回收的信息

```java
java.lang.ref.PhantomReference@9208cbf:被gc回收了
```

## 参考

[Java软引用究竟什么时候被回收](https://www.jianshu.com/p/e46158238a77)
[有关SoftReference的一些事实](https://in355hz.iteye.com/blog/1923393)

## 资料来源

- [java.lang.ref：可达性与引用类型](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/package-summary.html)
- [SoftReference：内存敏感引用](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/SoftReference.html)
- [PhantomReference：虚引用与引用队列](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/PhantomReference.html)
