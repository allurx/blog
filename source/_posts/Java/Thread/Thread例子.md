---
title: Thread例子
date: 2019-07-12
categories:
- Java
- Thread
- Thread例子
tags:
- Java
- Thread
- Thread例子
---

# 概述

一些线程相关的简单demo

<!-- more -->

# 三个线程循环打印ABC

```java
package com.example.demo;

/**
 * @author zyc
 */
public class DemoApplication {


    public static void main(String[] args) {
        Thread thread1 = new Worker("A", 0);
        Thread thread2 = new Worker("B", 1);
        Thread thread3 = new Worker("C", 2);
        thread1.start();
        thread2.start();
        thread3.start();
    }

    static class Worker extends Thread {
        static volatile int n = 0;
        int order = 0;

        Worker(String name, int order) {
            super(name);
            this.order = order;
        }

        @Override
        public void run() {
            while (true) {
                if (order == n) {
                    if (n == 2) {
                        System.out.println(getName());
                        n = 0;
                    } else {
                        System.out.print(getName());
                        n++;
                    }
                }
            }
        }
    }
}
```

