---
title: "Thread 常用方法"
date: 2019-07-09
updated: 2026-10-03
tags:
  - Java
  - Thread
  - Thread常用方法
domain: Java
---

线程方法分别等待时间、线程终止或业务条件，不能只因为都可能暂停执行就互相替代。本文先比较这些契约，再用独立的小程序观察中断、join、yield、监视器等待与异常分发。

范围是 Java 25 平台线程的公开行为。示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。各节 DemoApplication 都是独立程序，分别保存、编译和运行，不应把同名类放在同一目录。保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`。

## 按等待目标选择方法

| 操作 | 当前线程等待什么 | 是否释放已持有的监视器 |
| --- | --- | --- |
| Thread.sleep | 时间间隔 | 不释放 |
| worker.join | worker 终止，或预算耗尽 | 不会普遍释放调用者的其他锁 |
| object.wait | 通知、中断、超时或虚假唤醒，再重新获取监视器 | 只释放 object 的监视器 |
| LockSupport.park | 许可、中断或虚假唤醒 | 不释放监视器 |

sleep 不保证到期后立即获得 CPU。currentThread 返回真正执行当前代码的线程，isAlive 判断目标是否已启动且未终止。Thread.State 是观察值，不能用轮询某个状态替代业务同步。

## interrupt：发出协作请求

interrupt 作用于目标线程。目标在 wait、sleep 或 join 中等待时，按契约抛 InterruptedException 并清除中断标记；一般计算代码不会自动停止。下面主线程可能在子线程进入 wait 前或等待期间发出中断，两种情况都不需要用休眠保证先后。

```java
package io.allurx;

public class DemoApplication {

    static final Object lock = new Object();

    public static void main(String[] args) {
        Thread thread=new Thread(new InterruptedThread());
        thread.start();
        thread.interrupt();

    }

    static class InterruptedThread implements Runnable {

        @Override
        public void run() {
            synchronized (lock) {
                try {
                    lock.wait();
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }
    }

}
```

本次观察到 InterruptedException。它由示例打印，用来显示 wait 对中断的响应，不是未处理的业务故障。

## interrupted 与 isInterrupted：谁的标记被清除

Thread.interrupted 是静态方法，检查并清除当前执行线程的标记；isInterrupted 检查调用目标线程的标记，不清除。不要通过某个实例调用静态方法后，误以为检查的是该实例线程。

```java
package io.allurx;

public class DemoApplication {

    public static void main(String[] args) throws Exception {
        System.out.println(Thread.interrupted());
        Thread.currentThread().interrupt();
        System.out.println(Thread.interrupted());
        System.out.println(Thread.interrupted());
    }

}
```

输出依次为 false、true、false。把查询改为实例方法时，后两次仍为 true：

```java
package io.allurx;

public class DemoApplication {

    public static void main(String[] args) throws Exception {
        System.out.println(Thread.currentThread().isInterrupted());
        Thread.currentThread().interrupt();
        System.out.println(Thread.currentThread().isInterrupted());
        System.out.println(Thread.currentThread().isInterrupted());
    }

}
```

## join：等待的是目标线程结束

worker.join 由 main 执行，但等待条件是 worker 已终止。先 start 再 join；尚未启动的线程不处于存活状态，join 可以直接返回。下面无超时的 join 成功后，先打印 2，再打印 1。

```java
package io.allurx;

public class DemoApplication {

    public static void main(String[] args) throws InterruptedException {
        Worker worker = new Worker();
        worker.start();
        worker.join();
        System.out.println(1);
    }

    static class Worker extends Thread {

        @Override
        public void run() {
            try {
                Thread.sleep(2000);
                System.out.println(2);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }
    }

}
```

输出为 2、1。带 1000 毫秒预算的版本可以在目标尚未结束时返回：

```java
package io.allurx;

public class DemoApplication {

    public static void main(String[] args) throws InterruptedException {
        Worker worker = new Worker();
        worker.start();
        worker.join(1000);
        System.out.println(1);
    }

    static class Worker extends Thread {

        @Override
        public void run() {
            try {
                Thread.sleep(2000);
                System.out.println(2);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }
    }
}
```

常见观察是 1、2，但超时预算不保证调用者准点恢复，因此不能把它当作固定打印顺序的程序。

## yield：只是调度提示

yield 可以被调度器忽略，线程仍是 RUNNABLE。它不提供内存同步，也不保证其他线程先执行；JDK 25 中以 Thread.yield() 限定调用，避免与受限标识符冲突。

```java
package io.allurx;

public class DemoApplication {

    public static void main(String[] args) {
        Thread yieldThread1 = new YieldThread("YieldThread1");
        Thread yieldThread2 = new YieldThread("YieldThread2");
        yieldThread1.start();
        yieldThread2.start();

    }

    static class YieldThread extends Thread {
        YieldThread(String name) {
            super(name);
        }

        @Override
        public void run() {
            System.out.println(getName() + "开始执行");
            if ("YieldThread1".equals(getName())) {
                System.out.println(getName() + "让出cpu执行权");
                Thread.yield();
            }
            System.out.println(getName() + "执行结束");
        }
    }
}
```

输出先后不固定。只能确认代码进行了让步提示，不能由一次打印顺序推导调度保证。

## wait 与 notify：业务条件必须自己保存

wait 要求持有目标对象监视器，等待期间释放这个监视器，返回前重新取得。notify/notifyAll 不释放通知者的锁，也不保证等待者马上执行。下面把 ready 与通知放在同一个同步边界内，通知先发生也不会丢失状态。

```java
package io.allurx;

import java.time.LocalDateTime;

public class DemoApplication {

    private static final Object lock = new Object();
    private static boolean ready;

    public static void main(String[] args) throws Exception {
        new Worker("Worker").start();
        Thread.sleep(2000);
        synchronized (lock) {
            ready = true;
            lock.notifyAll();
        }
    }

    static class Worker extends Thread {

        Worker(String name) {
            super(name);
        }

        @Override
        public void run() {
            synchronized (lock) {
                try {
                    System.out.println(getName() + "开始运行: " + LocalDateTime.now());
                    while (!ready) {
                        lock.wait();
                    }
                    System.out.println(getName() + "结束运行: " + LocalDateTime.now());
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }
    }

}
```

Worker 在观察到 ready 后结束。sleep 只拉开演示间隔，正确性由监视器和 while 条件保证；时间戳不是等待时长承诺。

## 未捕获异常处理器：最后的报告入口

线程实例处理器优先于线程组和全局默认处理器。它用于报告已逃出 run 的异常，不会让失败任务从中断位置恢复，也不是 FutureTask 等任务结果容器的替代。

```java
package io.allurx;

public class DemoApplication {

    public static void main(String[] args) {
        Thread thread = new Worker();
        thread.setUncaughtExceptionHandler((t, e) -> System.out.println("线程实例的异常处理器"));
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> System.out.println("所有线程的异常处理器"));
        thread.start();
    }

    static class Worker extends Thread {

        @Override
        public void run() {
            System.out.println(1 / 0);
        }
    }
}
```

故意执行 1 / 0 后，输出“线程实例的异常处理器”。删除实例处理器才会沿线程组默认路径找到全局处理器。

## Java 8 的 join 循环解释了等待条件

[OpenJDK 8u202-b08 Thread](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/Thread.java) 使用目标线程对象的监视器反复检查 isAlive。无超时分支的核心是：

```java
while (isAlive()) {
    wait(0);
}
```

执行 wait 的是调用 join 的线程；this 是被等待的目标对象。线程终止时 JVM 配合通知，但循环仍需要应对其他通知和虚假唤醒。这个摘录解释历史实现，不要求应用在 Thread 对象上自建 wait/notify 协议，当前 JDK 也不必保持同一内部代码。

中断是请求，超时是等待预算，通知是重新检查机会。需要确保某件业务工作完成，应使用该工作的状态和完成协议，不能用 sleep、yield 或一次 getState 观察代替。

## 资料来源

- [Thread：interrupt、sleep、join 与异常处理](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
- [Object：wait、notify 与监视器契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html)
- [LockSupport 的条件等待示例](/lock-support/)
