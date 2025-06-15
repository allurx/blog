---
title: Thread基本概念
date: 2019-07-08
categories:
- Java
- Thread
- Thread基本概念
tags:
- Java
- Thread
- Thread基本概念
---

# 概述

> ​	线程是操作系统能够进行运算调度的最小单位。它被包含在进程之中，是进程中的实际运作单位。一个线程指的是进程中一个单一顺序的控制流，一个进程中可以并发多个线程，每条线程并行执行不同的任务。
> ​	同一进程中的多个线程将共享该进程中的全部系统资源，如虚拟地址空间，文件描述符和信号处理等等。但同一进程中的多个线程有各自的调用栈（call stack），自己的寄存器环境（register context），自己的线程本地存储（thread-local storage）。
> ​	一个进程可以有很多线程，每条线程并行执行不同的任务。

<!-- more -->

# 线程优先级

现代操作系统基本采用时间片的形式调度运行线程， 操作系统会分出一个个时间片， 线程会分配到若干时间片， 当线程的时间片用完了就会发生线程调度。 线程优先级就是决定操作系统是否优先分配时间片给该线程处理系统资源的属性。但是在不同的jvm及操作系统上，线程规划会存在差异，有些操作系统甚至会忽略对线程优先级的设定，因此在程序中设置线程优先级的实践意义并不大，因为线程优先级的最终解释权在底层操作系统。

## java线程优先级

在java中线程优先级一共被分成了10个等级

```java
	// 最低优先级
    public final static int MIN_PRIORITY = 1;

    // 默认优先级
    public final static int NORM_PRIORITY = 5;

    // 最高优先级
    public final static int MAX_PRIORITY = 10;
```

如果没有设置优先级的话，默认的优先级是5，可以调用线程提供的方法来手动设置优先级

```java
public final void setPriority(int newPriority) {
    ThreadGroup g;
    checkAccess();
    if (newPriority > MAX_PRIORITY || newPriority < MIN_PRIORITY) {
        throw new IllegalArgumentException();
    }
    if((g = getThreadGroup()) != null) {
        if (newPriority > g.getMaxPriority()) {
            newPriority = g.getMaxPriority();
        }
        setPriority0(priority = newPriority);
    }
}

private native void setPriority0(int newPriority);
```

1. 判断优先级是否在最小和最大的优先级范围内
2. 判断所属的ThreadGroup是否为null（基本上是不会为null的，初始化时会设置ThreadGroup），并且不允许超过所属ThreadGroup的最大优先级

虽然我们可以手动去设置某个线程的优先级，但是由于线程优先级的最终解释权在底层操作系统，所以这个参数的意义并不是很大

# 线程状态

在Thread源码中一共定义了6种线程状态

```java
public enum State {

        NEW,

        RUNNABLE,

        BLOCKED,

        WAITING,

        TIMED_WAITING,

        TERMINATED;
}
```

1. NEW：线程的构造函数被调用后，线程就是NEW状态。

2. RUNNABLE：调用`start()`方法后，线程的状态就是RUNNABLE，该状态指示表示线程可以运行，不表示线程当前一定在运行，线程是否运行由虚拟机所在操作系统调度决定。

3. BLOCKED：当线程尝试调用某个对象的`synchronized`方法或者`synchronized`代码块时会去尝试获取对象的monitor，如果当前对象的monitor被其他线程持有，当前线程就处于BLOCKED状态

4. WAITING

   * 当前线程持有某个对象（object）的monitor后，然后调用该对象的`object.wait()`方法

     ```java
     synchronized (obj) {
     	while (<condition does not hold>)
     	obj.wait();
     }
     ```

     此时，该线程就处于WAITING状态，需要其它拥有object的monitor线程调用`notify(), notifyAll()`方法才能改变该线程的状态

   * 当前线程执行另一个线程的`join()`方法后，当前线程处于WAITING状态

   * 调用`java.util.concurrent.locks.LockSupport.park()`方法后当前线程处于WAITING状态

5. TIMED_WAITING：和WAITING状态类似，在此基础上添加了超时属性

   * 调用`Thread.sleep（long millis）`方法后，当前线程就处于TIMED_WAITING状态
   * 调用带超时参数的`Object.wait`方法后，调用线程就处于TIMED_WAITING状态
   * 调用带超时参数的`Thread.join `方法后，调用线程所在的线程就处于TIMED_WAITING状态
   * 调用`LockSupport.parkNanos`和`LockSupport.parkUntil`方法后，当前线程就处于TIMED_WAITING状态
   
6. TERMINATED：线程执行完毕或者线程由于异常退出后就处于TERMINATED（终止）状态

   

在上面的6种状态中BLOCKED和WAITING这两种状态有点不是很好区别，只有当线程执行被synchronized修饰的代码块或者方法时，线程才会处于BLOCKED状态（无法获取目标对象的mointor），而当其它线程通过调用notify或者notifyAll方法唤醒此刻monitor上的线程时，被唤醒的线程是从之前阻塞的哪一行代码开始运行的，但是此刻也可能存在其它线程对这个mointor进行竞争，所以处于BLOCKED状态的线程被唤醒后，必定是立马转为BLOCKED状态，接着如果能够获取当前的mointor，那么线程状态则继续转换为RUNNABLE。

参考以下线程状态转换的图片

![](/images/Java/Thread_State.png)

# 守护线程（daemon）

java中有两类线程：User Thread(用户线程)和Daemon Thread(守护线程)

## User Thread

用户线程一般是指正在运行的线程，当我们手动创建一个线程实例时（确保当前创建线程所在的线程不是Daemon Thread），默认该线程就是User Thread

## Daemon Thread

守护线程一般都是一些后台任务线程，例如垃圾回收线程，他们主要是用来服务用户线程的。**当程序中所有用户线程都执行完毕后，jvm就会终止所有守护线程，但是jvm不会保证守护线程一定执行完毕**

```java
public class DemoApplication {

    public static void main(String[] args) {
        print();
        UserThread userThread = new UserThread("UserThread");
        DaemonThread daemonThread = new DaemonThread("DaemonThread");
        daemonThread.setDaemon(true);

        userThread.start();
        daemonThread.start();
    }

    static class UserThread extends Thread {

        UserThread(String name) {
            super(name);
        }

        @Override
        public void run() {
            print();
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }
    }

    static class DaemonThread extends Thread {

        DaemonThread(String name) {
            super(name);
        }

        @Override
        public void run() {
            print();
            new Thread(DemoApplication::print).start();
            new Thread(() -> {
                try {
                    Thread.sleep(1000);
                    print();
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }).start();
        }
    }

    static void print() {
        System.out.println(Thread.currentThread().getName() + ":" + Thread.currentThread().isDaemon());
    }

}
```

上面代码运行结果是

```
main:false
UserThread:false
DaemonThread:true
Thread-0:true
```

在主线程中开启名称为UserThread和DaemonThread两个线程，然后手动将名称为DaemonThread的线程设置为守护线程，然后在该守护线程中又开启两个线程，最终只有主线程开启的两个线程和守护线程中的第一个线程打印输出值，因此得出以下结论

1. 主线程不是守护线程
2. 守护线程中开启的线程默认也是守护线程
3. 当用户线程运行结束后，守护线程不能保证一定执行完毕
4. 必须在线程调用start方法前设置线程为守护线程

# 线程初始化

关于线程初始化这个问题，很多面试官都热衷于提问这个问题，在我看来这个这个问题的答案很简单，Thread一共有几个构造函数，那么线程就有几种初始化方式，常用的初始化方法无非就两种，要么继承Thread类重写它的run方法，要么实现Runnable结构，重写run方法，本质上这些方式都是按照Thread拥有的构造函数来实现的。查看Thread所拥有的的构造函数，它们最终都调用了名为init的方法来构造Thread对象

```java
private void init(ThreadGroup g, Runnable target, String name,
                  long stackSize, AccessControlContext acc,
                  boolean inheritThreadLocals) {
    if (name == null) {
        throw new NullPointerException("name cannot be null");
    }

    this.name = name;

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
    this.daemon = parent.isDaemon();
    this.priority = parent.getPriority();
    if (security == null || isCCLOverridden(parent.getClass()))
        this.contextClassLoader = parent.getContextClassLoader();
    else
        this.contextClassLoader = parent.contextClassLoader;
    this.inheritedAccessControlContext =
            acc != null ? acc : AccessController.getContext();
    this.target = target;
    setPriority(priority);
    if (inheritThreadLocals && parent.inheritableThreadLocals != null)
        this.inheritableThreadLocals =
            ThreadLocal.createInheritedMap(parent.inheritableThreadLocals);
    this.stackSize = stackSize;

    tid = nextThreadID();
}
```
线程初始化时主要做了以下几件事情：
1. 设置线程名称
2. 如果没有显示的指定被创建线程所在的ThreadGroup，并且如果当前存在SecurityManager的话就设置被创建线程的ThreadGroup为SecurityManager的ThreadGroup，否则设置为当前线程的ThreadGroup
3. 设置被创建线程的守护线程标记为当前线程的守护线程标记
4. 设置被创建线程优先级为当前线程的优先级
5. 设置被创建线程的ClassLoader
6. 设置被创建线程的AccessControlContext
7. 设置被创建线程的Runnable
8. 设置被创建线程是否需要从当前线程继承ThreadLocal
9. 设置stackSize
10. 设置线程id

# 线程启动

启动线程是调用线程类的`start()`方法

```java
public synchronized void start() {
   
    if (threadStatus != 0)
        throw new IllegalThreadStateException();

    group.add(this);
    
    boolean started = false;
    try {
        start0();
        started = true;
    } finally {
        try {
            if (!started) {
                group.threadStartFailed(this);
            }
        } catch (Throwable ignore) {

        }
    }
}

private native void start0();
```

从方法注释上我们可以得知java虚拟机会去调用该线程的run方法，结果是两个线程并发运行：当前线程（从调用start方法返回）和另一个线程（执行其run方法）。看一下Thread的run方法：

```java
@Override
public void run() {
	if (target != null) {
		target.run();
	}
}
```

如果Runnable不为null则调用Runnable的run方法。这就是为什么我们在初始化线程的时候要么继承Thread重写它的run方法（改变了默认的run逻辑）或者是实现Runnable接口重写run方法然后设置线程的target为这个Runnable。总结线程在启动时做的事情：

1. 判断线程当前的状态必须是New
2. 将启动的线程添加到所属的ThreadGroup中
3. 调用native方法`start0()`开始启动线程，java虚拟机通过这个`start0()`方法去调用启动线程的run方法执行运行逻辑
4. 如果线程启动失败就将该线程从所属ThreadGroup线程列表中移除

# 总结

本文主要概括了和线程相关的一些基本概念，了解这些基本概念是学习多线程以及并发的基础。





   

   

   

   

   

   

   

   