---
title: Java中的几种Reference
date: 2019-07-15
categories:
- Java
- Reference
tags:
- Java
- Reference
---

# 概述

Reference是什么？当我们定义一个变量时例如`Object O=new Object()`，这个o是变量名，new Object()是变量值，此时o就是一个引用变量，它引用了new Object()。在java中常见的引用有PhantomReference、SoftReference、WeakReference以及StrongReference，例如上面这个例子就是一个强引用。

<!-- more -->

# StrongReference

StrongReference是强引用的意思，java中并没有定义这样一个类，它只是一个引用的概念。当被引用的对象只要存在一个引用变量时，gc就不会回收这个对象，例如我们通过new出来的对象是存放在虚拟机的堆内存中的，此时定义的变量就是指向了堆内存中的这个对象，如果这个引用变量一直存活的话，那么gc就不会回收堆内存中的这个对象。

```java
public void test(){
	Object o = new Object();
}
```

假如我们程序中有以上一个方法，在该方法中定义了一个局部变量o指向了一个new Object()，这个Object被new出来后就会被存放在堆内存中，当该方法执行完毕后，局部变量o会被销毁，堆内存中的Object对象就没有引用指向它了，gc就会在适当的时候回收它，但如果这个o是我们定义的一个全局的变量，即便方法运行结束了，依旧指向了堆内存的Object对象，此时gc就不会回收它，一直占据着内存，随着项目越来越大，如果在业务上处理不当的话就会导致oom（OutOfMemoryError）。最典型的一个场景就是使用集合类当做对象的全局变量。随着集合对象包含的对象越来越多，很有可能会导致oom，因此当我们不使用某个对象的时候最好的方法是显示的设置它为null，这样gc在运行时就能够及时发现那些不存在引用的大对象，尽可能的避免oom。例如在ArrayList的clear方法中就有这样的一段话

```java
public void clear() {
    modCount++;

    // clear to let GC do its work
    for (int i = 0; i < size; i++)
        elementData[i] = null;

    size = 0;
}
```

ArrayList中保存的对象最终都会存放在内部维护的名为elementData的Object[]数组中，如果clear时，仅仅让elementData=null的话，数组内部的对象依然存在引用，因此源码中显示的将数组中的每个元素都指向了null，注释上也写明了这样做的目的是帮助gc更好的工作。

# SoftReference

SoftReference是软引用的意思，具体的类定义为java.lang.ref.SoftReference，从类注释上我们可以知道如果一个对象只存在软引用并且当系统内存不够时，gc就会回收这个对象。软引用最常用于实现对内存敏感的缓存。软引用可以与引用队列（ReferenceQueue）联合使用，如果软引用所引用的对象被垃圾回收器回收，jvm就会把这个软引用加入到与之关联的引用队列中。

```java
package com.example.demo;

import java.lang.ref.SoftReference;

/**
 * @author zyc
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

以上公式计算结果为false的话本次gc就不会清除SoftReference对象，否则就会清除SoftReference对象。

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

# WeakReference

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

源码很简单，同样弱引用也可以与引用队列（ReferenceQueue）联合使用，如果弱引用所引用的对象被垃圾回收器回收，jvm就会把这个软引用加入到与之关联的引用队列中。下面看一个例子

```java
package com.example.demo;

import java.lang.ref.WeakReference;

/**
 * @author zyc
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

# PhantomReference

PhantomReference是虚引用的意思，具体的类定义为java.lang.ref.PhantomReference，它与上面的其它引用都不同，PhantomReference不会影响被引用对象的生命周期。如果一个对象仅持有虚引用，那么它就和没有任何引用一样，在任何时候都可能被垃圾回收器回收。并且PhantomReference必须配合引用队列（ReferenceQueue）联合使用，它的唯一作用是当垃圾回收器准备回收一个对象时，如果发现它还有虚引用，就会在回收对象之前，把这个虚引用加入到与之关联的引用队列中。看一下它的源码：

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

源码很简单，并且我们发现它的get方法始终返回null，正因为PhantomReference的作用不是为了去影响对象的生命周期，所以它没必要返回引用的对象。并且唯一的构造函数也标明了它必须和一个ReferenceQueue配合使用。下面看一个例子

```java
package com.example.demo;

import java.lang.ref.PhantomReference;
import java.lang.ref.Reference;
import java.lang.ref.ReferenceQueue;

/**
 * @author zyc
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

# 参考

[Java软引用究竟什么时候被回收](https://www.jianshu.com/p/e46158238a77)
[有关SoftReference的一些事实](https://in355hz.iteye.com/blog/1923393)