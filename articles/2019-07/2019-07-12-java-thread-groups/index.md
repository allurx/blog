---
title: ThreadGroup
date: 2019-07-12
updated: 2026-10-01
id: 2019-07-12-java-thread-groups
tags:
  - Java
  - Thread
  - ThreadGroup
domain: Java
---

## 核心结论

`ThreadGroup` 将平台线程组织成组，并提供枚举、中断和未捕获异常处理的入口；统计结果只是估计值，不能代替任务完成协议。原文的显式销毁与 `SecurityManager` 检查属于历史实现。JDK 25 的 `destroy()` 已弃用且不执行销毁，线程组由可达性决定是否可被回收。

## 问题与适用范围

本文回答原文线程组树与旧源码的工作方式，未提供精确源码修订。阅读 `destroy()`、`destroyed`、安全检查等内容时，应与文末 JDK 25 API 对照。虚拟线程使用特殊线程组，不能用本文的组枚举方式管理它们；新业务的任务生命周期应由执行器或明确的任务协议管理。

<!-- more -->

```java
private void init(ThreadGroup g, Runnable target, String name,
                      long stackSize, AccessControlContext acc,
                      boolean inheritThreadLocals) {
        ...省略部分代码
        Thread parent = currentThread();
        SecurityManager security = System.getSecurityManager();
        if (g == null) {

            if (security != null) {
                g = security.getThreadGroup();
            }

            if (g == null) {
                g = parent.getThreadGroup();
            }
        }
        g.checkAccess();
        if (security != null) {
            if (isCCLOverridden(getClass())) {
                security.checkPermission(SUBCLASS_IMPLEMENTATION_PERMISSION);
            }
        }
        g.addUnstarted();
        this.group = g;
        ...省略部分代码
    }
```

## ThreadGroup的成员变量

```java
// 所属父线程组
private final ThreadGroup parent;
// 线程组的名称
String name;
// 线程组中的线程允许的最大优先级
int maxPriority;
// 线程组是否已被销毁
boolean destroyed;
// 线程组是否是守护线程组
boolean daemon;
boolean vmAllowSuspension;
// 线程组内未启动的线程数
int nUnstartedThreads = 0;
// 线程组内的线程数
int nthreads;
// 线程组内的线程
Thread threads[];
// 线程组内包括的线程组数
int ngroups;
// 线程组内包括的所有线程组
ThreadGroup groups[];
```

## ThreadGroup的构造函数

ThreadGroup中一共定义了四个构造函数，其中两个为私有的两个为公共的

### public ThreadGroup(String name)

```java
public ThreadGroup(String name) {
	this(Thread.currentThread().getThreadGroup(), name);
}
```

指定线程组的名称，父线程组为当前正在执行的线程

### public ThreadGroup(ThreadGroup parent, String name)

```java
public ThreadGroup(ThreadGroup parent, String name) {
	this(checkParentAccess(parent), parent, name);
}
```

指定线程组的父线程组和线程组的名称，并检查父线程的访问许可

### private ThreadGroup(Void unused, ThreadGroup parent, String name)

```java
private ThreadGroup(Void unused, ThreadGroup parent, String name) {
    this.name = name;
    this.maxPriority = parent.maxPriority;
    this.daemon = parent.daemon;
    this.vmAllowSuspension = parent.vmAllowSuspension;
    this.parent = parent;
    parent.add(this);
}
```

两个公共的构造函数最终都是调用这个构造函数初始化的，指定了线程组的一些属性，都保持和父线程组一致，最后将该线程组添加到父线程组中。

### private ThreadGroup()

```java
private ThreadGroup() {     // called from C code
    this.name = "system";
    this.maxPriority = Thread.MAX_PRIORITY;
    this.parent = null;
}
```

创建一个不在任何Thread组中的空Thread组。 此方法用于创建系统线程组。

## ThreadGroup常用方法

### public int activeCount()

```java
public int activeCount() {
    int result;
    // Snapshot sub-group data so we don't hold this lock
    // while our children are computing.
    int ngroupsSnapshot;
    ThreadGroup[] groupsSnapshot;
    synchronized (this) {
        if (destroyed) {
            return 0;
        }
        result = nthreads;
        ngroupsSnapshot = ngroups;
        if (groups != null) {
            groupsSnapshot = Arrays.copyOf(groups, ngroupsSnapshot);
        } else {
            groupsSnapshot = null;
        }
    }
    for (int i = 0 ; i < ngroupsSnapshot ; i++) {
        result += groupsSnapshot[i].activeCount();
    }
    return result;
}
```

统计当前线程组内以及包含的子线程组内所有的线程数量

### public int activeGroupCount()

```java
public int activeGroupCount() {
    int ngroupsSnapshot;
    ThreadGroup[] groupsSnapshot;
    synchronized (this) {
        if (destroyed) {
            return 0;
        }
        ngroupsSnapshot = ngroups;
        if (groups != null) {
            groupsSnapshot = Arrays.copyOf(groups, ngroupsSnapshot);
        } else {
            groupsSnapshot = null;
        }
    }
    int n = ngroupsSnapshot;
    for (int i = 0 ; i < ngroupsSnapshot ; i++) {
        n += groupsSnapshot[i].activeGroupCount();
    }
    return n;
}
```

统计当前线程组内以及包含的子线程组内所有的线程组数量

### public final void destroy()

以下是原文旧实现的显式销毁逻辑。JDK 25 中该方法已弃用且无操作；线程组没有存活线程且不再可达时可以被 GC 回收。不要用以下代码判断当前 JDK 的销毁行为。

```java
public final void destroy() {
    int ngroupsSnapshot;
    ThreadGroup[] groupsSnapshot;
    synchronized (this) {
        checkAccess();
        if (destroyed || (nthreads > 0)) {
            throw new IllegalThreadStateException();
        }
        ngroupsSnapshot = ngroups;
        if (groups != null) {
            groupsSnapshot = Arrays.copyOf(groups, ngroupsSnapshot);
        } else {
            groupsSnapshot = null;
        }
        if (parent != null) {
            destroyed = true;
            ngroups = 0;
            groups = null;
            nthreads = 0;
            threads = null;
        }
    }
    for (int i = 0 ; i < ngroupsSnapshot ; i += 1) {
        groupsSnapshot[i].destroy();
    }
    if (parent != null) {
        parent.remove(this);
    }
}
```

销毁此线程组及其所有子线程组。 此线程组内的线程必须全部执行完毕了，否则会抛出IllegalThreadStateException异常，最终将所有的成员变量初始化为null并且将此线程组从它的父线程组中删除。

### public int enumerate(Thread list[])

```java
public int enumerate(Thread list[]) {
	checkAccess();
	return enumerate(list, 0, true);
}
```

将此线程组及其子组中的每个活动线程复制到指定的数组中。注意如果数组长度不够大，只会复制数组长度大小这么多的线程到该数组中

### public int enumerate(Thread list[], boolean recurse)

```java
public int enumerate(Thread list[], boolean recurse) {
	checkAccess();
	return enumerate(list, 0, recurse);
}
```

将此线程组中的每个活动线程复制到指定的数组中。如果recurse为true代表递归的复制子线程组中所有的活动线程引用。注意如果数组长度不够大，只会复制数组长度大小这么多的线程到该数组中

这两个复制线程的方法都调用了一个私有的`enumerate(Thread list[], int n, boolean recurse)`方法，有兴趣的可以自己去研究一下源码，这里就不多做分析了。

### public int enumerate(ThreadGroup list[])

```java
public int enumerate(ThreadGroup list[]) {
	checkAccess();
	return enumerate(list, 0, true);
}
```

复制到此线程组及其子组中每个活动子组的指定数组引用。注意如果数组长度不够大，只会复制数组长度大小这么多的线程组到该数组中

### public int enumerate(ThreadGroup list[], boolean recurse)

```java
public int enumerate(ThreadGroup list[], boolean recurse) {
	checkAccess();
	return enumerate(list, 0, recurse);
}
```

将此线程组中的每个活动线程组复制到指定的数组中。 如果recurse为true，代表递归的复制子线程组中所有的活动线程组引用。注意如果数组长度不够大，只会复制数组长度大小这么多的线程组到该数组中

这两个复制线程组的方法都调用了一个私有的`enumerate(ThreadGroup list[], int n, boolean recurse)`方法，有兴趣的可以自己去研究一下源码，这里就不多做分析了。

### public final void interrupt()

```java
public final void interrupt() {
    int ngroupsSnapshot;
    ThreadGroup[] groupsSnapshot;
    synchronized (this) {
        checkAccess();
        for (int i = 0 ; i < nthreads ; i++) {
            threads[i].interrupt();
        }
        ngroupsSnapshot = ngroups;
        if (groups != null) {
            groupsSnapshot = Arrays.copyOf(groups, ngroupsSnapshot);
        } else {
            groupsSnapshot = null;
        }
    }
    for (int i = 0 ; i < ngroupsSnapshot ; i++) {
        groupsSnapshot[i].interrupt();
    }
}
```

中断此线程组中的所有线程。此方法会在此线程组及其所有子组中的所有线程上调用interrupt方法。有关interrupt方法的用法可以查看之前**Thread常用方法**一文

### public final boolean parentOf(ThreadGroup g)

```java
public final boolean parentOf(ThreadGroup g) {
    for (; g != null ; g = g.parent) {
        if (g == this) {
            return true;
        }
    }
    return false;
}
```

判断此线程组是线程组参数还是其祖先线程组之一

### public void uncaughtException(Thread t, Throwable e)

```java
public void uncaughtException(Thread t, Throwable e) {
    if (parent != null) {
        parent.uncaughtException(t, e);
    } else {
        Thread.UncaughtExceptionHandler ueh =
            Thread.getDefaultUncaughtExceptionHandler();
        if (ueh != null) {
            ueh.uncaughtException(t, e);
        } else if (!(e instanceof ThreadDeath)) {
            System.err.print("Exception in thread \""
                             + t.getName() + "\" ");
            e.printStackTrace(System.err);
        }
    }
}
```

该方法在**线程常用方法**一文中分析过，这里就不多做分析了。

## 例子

```java
package io.allurx;

import java.util.Arrays;
import java.util.concurrent.ThreadFactory;

/**
 * @author allurx
 */
public class DemoApplication {

    public static void main(String[] args) {
        CustomizedThreadGroup customizedThreadGroup = new CustomizedThreadGroup();
        customizedThreadGroup.newThread(() -> {
            Thread thread = Thread.currentThread();
            ThreadGroup threadGroup = thread.getThreadGroup();
            Thread[] threads = new Thread[1];
            System.out.println(thread.getName());
            System.out.println(threadGroup);
            System.out.println(threadGroup.getMaxPriority());
            System.out.println(threadGroup.getParent());
            System.out.println(threadGroup.activeCount());
            System.out.println(threadGroup.activeGroupCount());
            System.out.println(threadGroup.getParent().parentOf(threadGroup));
            threadGroup.enumerate(threads);
            System.out.println(Arrays.toString(threads));
            System.out.println(1 / 0);
        }).start();
    }

    static class CustomizedThreadGroup extends ThreadGroup implements ThreadFactory {

        private static int n = 0;

        private synchronized String nextThreadName() {
            return "CustomizedThreadGroup-" + n++;
        }

        public CustomizedThreadGroup() {
            super("CustomizedThreadGroup");
        }

        @Override
        public Thread newThread(Runnable runnable) {
            return new Thread(this, runnable, nextThreadName());
        }

        @Override
        public void uncaughtException(Thread t, Throwable e) {
            System.out.print("CustomizedThreadGroup里面的" + t.getName() + "运行时出现了异常:");
            e.printStackTrace();
        }
    }
}
```

输出

```
CustomizedThreadGroup-0
io.allurx.DemoApplication$CustomizedThreadGroup[name=CustomizedThreadGroup,maxpri=10]
10
java.lang.ThreadGroup[name=main,maxpri=10]
1
0
true
[Thread[CustomizedThreadGroup-0,5,CustomizedThreadGroup]]
CustomizedThreadGroup里面的CustomizedThreadGroup-0运行时出现了异常:java.lang.ArithmeticException: / by zero
	at io.allurx.DemoApplication.lambda$main$0(DemoApplication.java:26)
	at java.lang.Thread.run(Thread.java:748)
```

## 总结

本文主要介绍了ThreadGroup相关的一些概念和基本方法的使用，原文中的平台线程默认继承创建者的线程组；当前虚拟线程则使用专门的线程组。了解线程和线程组之间的关系能够帮助我们更好的编写线程相关的代码。

## 资料来源

- [JDK 25 ThreadGroup：现行行为与弃用 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadGroup.html)
- [JDK 25 Thread：虚拟线程的线程组](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
