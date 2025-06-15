---
title: Synchronized用法
date: 2019-07-11
categories:
- Java
- Thread
- Synchronized
tags:
- Java
- Thread
- Synchronized
---

# 概述

synchronized意为同步的意思，使用它能够保证在多线程运行的情况下同步阻塞的访问共享数据。java中每一个对象都可以作为锁，这是synchronized实现同步的基础，本文将探讨synchronized的几种用法。

<!-- more -->

# 修饰静态方法

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

# 修饰实例方法

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

synchronized修饰类的实例方法，可以保证在多线程运行的情况下同时只有一个线程能够访问这个实例的所有实例方法（静态方法其它线程还是可以访问的），正如上面的例子，两个线程同时访问DemoApplication实例对象的increase方法，输出的结果为2000，和预期的一致。

# 修饰class对象

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

synchronized修饰class对象，可以保证在多线程运行的情况下只能有一个线程访问类的所有方法，注意无论是静态方法还是实例方法此刻都只能有一个线程访问。正如上面的例子，两个线程需要对类的共享变量n进行增加操作，输出的结果为2000，和预期的一致。

# 修饰实例对象

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

synchronized修饰实例对象，可以保证在多线程运行的情况下同时只有一个线程能够访问这个实例的所有实例方法（静态方法其它线程还是可以访问的），正如上面的例子，两个线程同时访问DemoApplication实例对象的increase方法，输出的结果为2000，和预期的一致。

# 修饰实例变量

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

synchronized修饰成员变量，可以保证在多线程运行的情况下同时只有一个线程能够访问这个实例的包含同步变量的方法（静态方法以及不包含同步变量的方法其它线程还是可以访问的），正如上面的例子，两个线程同时访问DemoApplication实例对象的increase方法，输出的结果为2000，和预期的一致。当然啦如果这个变量是被static修饰的，其它线程依旧不能访问包含同步变量的方法。

# 总结

本文主要总结了synchronized的几种用法，它可以用来确保多线程有序的访问共享的资源。本质上synchronized是通过对象的monitor来实现的，因为当线程进入被synchronized修饰的方法或者代码块后就拥有了某个对象的monitor，例如修饰静态方法就拥有了整个类的monitor，修饰class对象就拥有了整个类的monitor，修饰实例对象就拥有了这个实例的monitor，修饰实例变量就拥有了这个实例变量的monitor，此时其它线程如果访问这个对象时就会被阻塞，除非上一个线程释放该对象的monitor，其它线程才会被cpu调度进而有序的访问该对象所处的方法或者代码块。