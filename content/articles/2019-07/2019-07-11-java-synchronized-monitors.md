---
title: Synchronized用法
date: 2019-07-11
id: 2019-07-11-java-synchronized-monitors
tags:
  - Java
  - Thread
  - Synchronized
domain: Java
---

## 核心结论

`synchronized` 以具体对象的监视器作为互斥边界。实例同步方法锁住 `this`，静态同步方法锁住声明类的 `Class` 对象，同步块锁住括号中的对象。只有竞争同一个监视器的代码才会互斥；未使用该监视器的普通方法仍可以执行。

## 问题与适用范围

本文回答几种写法究竟锁住哪个对象，并用自增示例比较静态锁与实例锁。它不保证所有方法都被锁住，也不自动保证公平。共享字段的全部相关访问需要遵循一致的同步协议；不同实例的 `this` 锁不能共同保护一个静态共享字段。

<!-- more -->

## 修饰静态方法

```java
public class DemoApplication {

    private static int n = 0;

    static synchronized void increase() {
        n++;
    }

    public static void main(String[] args) throws Exception {
        Thread thread1 = new Worker();
        Thread thread2 = new Worker();
        thread1.start();
        thread2.start();
        thread1.join();
        thread2.join();
        System.out.println(n);
    }

    static class Worker extends Thread {

        @Override
        public void run() {
            for (int i = 0; i < 1000; i++) {
                increase();
            }
        }
    }
}
```

synchronized修饰类的静态方法，可以保证在多线程运行的情况下同时只有一个线程能够访问这个静态方法，正如上面的例子，两个线程需要对类的共享变量n进行增加操作（n++不是原子性的操作），输出的结果为2000，和预期的一致。

## 修饰实例方法

```java
public class DemoApplication {

    private static int n = 0;

    synchronized void increase() {
        n++;
    }

    public static void main(String[] args) throws Exception {
        DemoApplication demoApplication = new DemoApplication();
        Thread thread1 = demoApplication.new Worker();
        Thread thread2 = demoApplication.new Worker();
        thread1.start();
        thread2.start();
        thread1.join();
        thread2.join();
        System.out.println(n);
    }

    class Worker extends Thread {

        @Override
        public void run() {
            for (int i = 0; i < 1000; i++) {
                increase();
            }
        }
    }
}
```

synchronized修饰类的实例方法，只让竞争同一个实例监视器的同步方法或同步块互斥；未同步的方法仍可并发执行，正如上面的例子，两个线程同时访问DemoApplication实例对象的increase方法，输出的结果为2000，和预期的一致。

## 修饰class对象

```java
public class DemoApplication {

    private static int n = 0;

    static void increase() {
        synchronized (DemoApplication.class) {
            n++;
        }
    }

    public static void main(String[] args) throws Exception {
        Thread thread1 = new Worker();
        Thread thread2 = new Worker();
        thread1.start();
        thread2.start();
        thread1.join();
        thread2.join();
        System.out.println(n);
    }

    static class Worker extends Thread {

        @Override
        public void run() {
            for (int i = 0; i < 1000; i++) {
                increase();
            }
        }
    }
}
```

synchronized修饰class对象，只让竞争同一个 Class 对象监视器的代码互斥，不会自动阻止所有静态方法和实例方法的执行。正如上面的例子，两个线程需要对类的共享变量n进行增加操作，输出的结果为2000，和预期的一致。

## 修饰实例对象

```java
public class DemoApplication {

    private static int n = 0;

    void increase() {
        synchronized (this){
            n++;
        }
    }

    public static void main(String[] args) throws Exception {
        DemoApplication demoApplication = new DemoApplication();
        Thread thread1 = demoApplication.new Worker();
        Thread thread2 = demoApplication.new Worker();
        thread1.start();
        thread2.start();
        thread1.join();
        thread2.join();
        System.out.println(n);
    }

    class Worker extends Thread {

        @Override
        public void run() {
            for (int i = 0; i < 1000; i++) {
                increase();
            }
        }
    }
}
```

synchronized修饰实例对象，只让竞争同一个实例对象监视器的代码互斥，普通方法及使用不同监视器的同步代码仍可执行，正如上面的例子，两个线程同时访问DemoApplication实例对象的increase方法，输出的结果为2000，和预期的一致。

## 修饰实例变量

```java
public class DemoApplication {

    private static int n = 0;

    private final Object lock = new Object();

    void increase() {
        synchronized (lock) {
            n++;
        }
    }

    public static void main(String[] args) throws Exception {
        DemoApplication demoApplication = new DemoApplication();
        Thread thread1 = demoApplication.new Worker();
        Thread thread2 = demoApplication.new Worker();
        thread1.start();
        thread2.start();
        thread1.join();
        thread2.join();
        System.out.println(n);
    }

    class Worker extends Thread {

        @Override
        public void run() {
            for (int i = 0; i < 1000; i++) {
                increase();
            }
        }
    }
}
```

这里的同步块锁住成员变量引用的对象，只有使用同一个对象监视器的代码才互斥，正如上面的例子，两个线程同时访问DemoApplication实例对象的increase方法，输出的结果为2000，和预期的一致。即使该引用是 static，也不会自动限制所有访问该变量的方法；它们仍需遵守相同的同步协议。

## 总结

本文主要总结了synchronized的几种用法，它可以用来确保多线程有序的访问共享的资源。本质上synchronized是通过对象的monitor来实现的，因为当线程进入被synchronized修饰的方法或者代码块后就拥有了某个对象的monitor，例如修饰静态方法就拥有了整个类的monitor，修饰class对象就拥有了整个类的monitor，修饰实例对象就拥有了这个实例的monitor，修饰实例变量就拥有了这个实例变量的monitor，其他线程只有在尝试获取同一个 monitor 时才会等待。释放监视器后，竞争者可以继续获取，但规范不保证公平的获取顺序。

## 资料来源

- [JLS 14.19：synchronized 语句](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.19)
- [JLS 17.1：锁与监视器](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.1)
