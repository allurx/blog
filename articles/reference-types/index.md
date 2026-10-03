---
title: Java 引用类型怎样影响对象回收
date: 2019-07-15
updated: 2026-10-03
tags:
  - Java
  - Reference
domain: Java
---

把一个局部变量赋成 `null` 后，对象为什么还留在堆里？也许缓存里还存着它，也许另一个对象的字段仍指向它。GC 判断的是从 GC Roots 出发是否还有可达路径，单独断开一条引用并不能决定整个对象的命运。

软引用、弱引用和虚引用进一步改变了这些路径的含义：有的允许内存紧张时放弃对象，有的不应延长对象寿命，有的只让程序观察回收通知。理解它们时要同时看两件事：被引用对象还能否取得，以及保存引用的容器还有什么工作需要完成。

本文使用 Java 引用 API，并以 OpenJDK 8u202-b08 解释软引用策略和虚引用实现。System.gc 只提出回收请求，不保证执行时间；需要确定性关闭的文件、连接等资源仍应按作用域显式关闭。


弱引用用法示例以 Java 25 为目标，只依赖标准库。源码讨论另行标明 Java 8 与 Java 25 的不同契约；实验只能观察本次 GC 行为，不能把一次结果提升为回收时间保证。

本文完整用法示例已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译并运行。

## 从强引用开始追踪谁还持有对象

Java 没有名为 StrongReference 的标准类。普通变量、对象字段和数组元素保存的对象引用都是强引用路径的一部分。只要对象仍从 GC Roots 强可达，就不能作为不可达对象回收。

局部变量的词法作用域不等于对象一定存活到方法结束。JVM 可以在确认后续不再使用对象时缩短它的实际存活期；反过来，对象即使离开创建它的方法，也可能仍被静态集合或其他存活对象引用。检查内存滞留时，应沿引用路径找出谁还持有对象，而不是机械地给每个局部变量赋 null。

例如 ArrayList.clear 保留内部数组供后续复用，因此要把有效槽位置为 null，解除数组到元素的引用。若整个集合已经不可达，则不需要先逐个清空元素才能回收；不可达对象之间存在循环引用也不会让它们永久存活。

## 允许 GC 清除对象的两种引用

### 软引用：保留多久受内存需求影响

SoftReference 的 referent 在不再强可达、但仍软可达时，可以由 GC 根据内存需求清除。API 保证虚拟机抛出 OutOfMemoryError 前已清除指向软可达对象的软引用，但这不是“SoftReference 包装对象本身必定被回收”，也不规定平时的清除时刻或顺序。注册了 ReferenceQueue 的已清除软引用，会在清除时或随后入队。

调用 get 时有两种结果：返回对象，此次返回值本身形成强引用；或者返回 null，表示需要按缺值处理。缓存不能假定软引用至少保留多久，也不能依靠它提供严格的容量或延迟控制。

#### OpenJDK 8u202-b08 怎样记录最近访问

该版本的 SoftReference 保存由 GC 更新的 clock，以及最近一次访问观察到的 timestamp。get 的核心逻辑如下：

```java
public T get() {
    T o = super.get();
    if (o != null && this.timestamp != clock)
        this.timestamp = clock;
    return o;
}
```

这里记录的是 GC 时钟快照，不是每次 get 调用的精确墙上时间。成功读取后更新 timestamp，会影响采用近期使用策略的后续清理决定。[SoftReference 源码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ref/SoftReference.java)

HotSpot 的 referencePolicy.cpp 定义了两种 LRU 保留窗口：LRUCurrentHeapPolicy 使用上次 GC 后的空闲堆大小，LRUMaxHeapPolicy 使用最大堆减去上次 GC 后已用堆大小。两者都先将容量换算为 MB，再乘 SoftRefLRUPolicyMSPerMB：

```text
保留窗口 = 可用容量的 MB 数 × SoftRefLRUPolicyMSPerMB
引用年龄 = 当前 GC 时钟 - timestamp
```

在这些策略中，引用年龄不大于保留窗口时返回“不清除”，超过时才返回“清除”。这是具体策略的决定，不能替代所有回收阶段的处理。即使参数设为零，刚访问过的引用年龄也可能为零，因此不能承诺“每次 GC 立即清除全部软引用”。[HotSpot 引用策略源码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/hotspot/src/share/vm/memory/referencePolicy.cpp)

### 弱引用：对象弱可达时清除引用

WeakReference 不会像软引用那样根据内存需求保留对象。GC 判定对象已经弱可达时，会按弱引用契约清除相应引用，并在同一时刻或随后将已注册的引用对象入队。判定条件是弱可达；仅仅没有强引用并不够，对象还可能通过软引用保持软可达。

清除弱引用也不等于清理围绕它建立的全部数据结构。例如 Map 的键是弱引用而值是强引用时，键被清除后，条目和 value 仍可能由 Map 持有；容器必须有自己的过期条目清理逻辑。

#### 用程序分别观察清除与入队

这里有两个不同对象：`new Object()` 创建的目标对象，以及包装它的 `WeakReference`。GC 清除的是引用通向目标的关系，队列里收到的却是这个 `WeakReference`，所以程序仍需保留包装对象，才能识别通知属于谁。

下面最多等待一秒，观察清除和入队。使用新建 `Object` 避免装箱缓存干扰。将代码保存为 `WeakReferenceDemo.java`，执行 `javac -encoding UTF-8 -d out WeakReferenceDemo.java` 和 `java -cp out io.allurx.WeakReferenceDemo`：

```java
package io.allurx;

import java.lang.ref.Reference;
import java.lang.ref.ReferenceQueue;
import java.lang.ref.WeakReference;

/**
 * @author allurx
 */
public class WeakReferenceDemo {
    public static void main(String[] args) throws InterruptedException {
        ReferenceQueue<Object> queue = new ReferenceQueue<>();
        WeakReference<Object> reference = new WeakReference<>(new Object(), queue);

        System.gc();
        Reference<?> queued = queue.remove(1000);
        System.out.println("已清除: " + (reference.get() == null));
        System.out.println("本次观察到入队: " + (queued == reference));
    }
}
```

两行输出分别回答“这次读取时是否已清除”和“等待期间是否拿到对应引用”。超时只说明本次没有观察到入队，不证明对象仍被强引用，更不证明 JVM 没有执行任何 GC。

## 虚引用：无法重新取得对象

PhantomReference.get 始终返回 null。程序通过关联的 ReferenceQueue 观察引用入队，再执行与 referent 分离的清理动作。构造器允许队列为 null，但此时无法收到入队通知。入队的是 PhantomReference 对象，不是 referent 本身。

OpenJDK 8u202-b08 的虚引用在入队时不会自动清除 referent，处理后应 clear 或让虚引用对象本身不可达。JDK 25 的契约则规定 GC 判定虚可达后原子地清除相应虚引用；应按实际运行版本理解生命周期，不能将 Java 8 的处理细节推广到所有版本。[Java 8 虚引用源码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ref/PhantomReference.java)、[JDK 25 PhantomReference 契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/PhantomReference.html)

实现资源跟踪时，还需要保持 PhantomReference 自身可达，并确保清理状态不强引用 referent。否则，前者可能使通知丢失，后者则让对象一直无法进入虚可达状态。对于要求及时释放的资源，优先使用 try-with-resources 等明确的生命周期管理；引用队列适合辅助跟踪，不能提供确定的完成时间。

## 选择引用时，把回收通知与业务清理分开

| 形式 | 对 referent 的影响 | 调用方仍需承担的职责 |
| --- | --- | --- |
| 强引用 | 保持强可达路径 | 在业务生命周期结束后解除不需要的持有 |
| 软引用 | 可按内存需求清除 | 缓存必须能处理随时缺值 |
| 弱引用 | 弱可达时不提供软引用保留窗口 | 清理容器中的残留条目和 value |
| 虚引用 | get 永远取不到 referent | 保持引用对象自身可达，并单独执行清理动作 |

ReferenceQueue 观察的是引用对象入队，不是“业务资源已释放”。引用强度、入队通知和文件/连接的确定性关闭应分别设计。

回到开篇的缓存：如果业务已经不需要某条记录，首先应解除缓存对它的持有。改用软引用或弱引用，只改变 GC 如何处理目标对象；它不会自动删除容器中无用的键、统计信息或其他强引用。需要严格容量和及时释放时，仍要在业务生命周期中安排相应操作。

## 资料来源

- [Java 8 java.lang.ref：可达性与引用类型](https://docs.oracle.com/javase/8/docs/api/java/lang/ref/package-summary.html)
- [Java 8 SoftReference：清除与内存需求](https://docs.oracle.com/javase/8/docs/api/java/lang/ref/SoftReference.html)
- [Java 8 WeakReference：弱可达性与入队](https://docs.oracle.com/javase/8/docs/api/java/lang/ref/WeakReference.html)
