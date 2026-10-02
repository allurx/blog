---
title: "Thread 常用方法"
date: 2019-07-09
updated: 2026-10-02
tags:
  - Java
  - Thread
  - Thread常用方法
domain: Java
---

`interrupt()` 发出协作式中断信号，`join()` 等待另一个线程终止，`sleep()` 暂停当前线程且不释放已持有的监视器。`Object.wait()` 则要求持有目标监视器，并在等待时释放它；被唤醒后还需重新获取监视器。选择方法时要明确等待的是时间、线程终止还是业务条件。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/Thread.java) 的 Thread 实现与平台线程示例解释中断、休眠和等待。中断是协作式请求；wait 必须在循环中检查业务条件，并在返回前重新获得监视器。


## isAlive方法

```java
public final native boolean isAlive();
```

判断当前线程是否处于存活状态，只有已经调用了start方法并且没有死亡的线程才处于存活状态

## currentThread方法

```java
public static native Thread currentThread();
```

返回对当前正在执行的线程对象的引用。也就是返回执行这段代码的线程。

## interrupt方法

interrupt意为中断和打断的意思，它的作用是为了去中断当前线程的执行，在Thread中一共定义了四个中断相关的方法

```java
public void interrupt() {
    if (this != Thread.currentThread())
        checkAccess();

    synchronized (blockerLock) {
        Interruptible b = blocker;
        if (b != null) {
            interrupt0();           // Just to set the interrupt flag
            b.interrupt(this);
            return;
        }
    }
    interrupt0();
}

// 判断执行该方法的线程是否处于中断状态，注意如果线程处于中断状态，该方法最终会清除线程的中断状态
public static boolean interrupted() {
    return currentThread().isInterrupted(true);
}

// 判断执行该方法的线程是否处于中断状态，不会清除线程中断状态
public boolean isInterrupted() {
    return isInterrupted(false);
}


private native boolean isInterrupted(boolean ClearInterrupted);
```

### `public void interrupt()`

interrupt 作用于接收调用的目标线程，发出协作式中断请求。目标线程在 wait、join 或 sleep 中等待时，会抛出 InterruptedException 并清除中断标记；sleep 和 join 不要求调用者预先持有某个监视器。一般计算代码不会因此自动停止，必须主动检查中断；LockSupport.park 因中断返回时保留标记。

```java
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

lock被synchronized修饰，当子线程执行run方法获取到lock的monitor，然后lock调用wait方法，子线程被挂起处于WAITING状态，然后主线程调用子线程的interrupt方法，最终子线程抛出InterruptedException异常

### `public static boolean interrupted()`

该方法是Thread的静态方法，用来判断执行该方法的线程是否处于中断状态，注意如果此时线程处于中断状态，那么该方法会重置该线程的中断状态

```java
public class DemoApplication {

    public static void main(String[] args) throws Exception {
        System.out.println(Thread.interrupted());
        Thread.currentThread().interrupt();
        System.out.println(Thread.interrupted());
        System.out.println(Thread.interrupted());
    }

}
```

控制台输出

```
false
true
false
```

由于一开始我没有设置主线程的中断状态，所以第一次输出为false，然后设置主线程为中断状态，结果输出true，最后再次打印主线程的中断状态，输出false，这是由于Thread.interrupted()方法会重置线程的中断状态

### `public boolean isInterrupted()`

该方法是Thread的实例方法，仅仅判断该实例线程是否处于中断状态，不会改变线程的中断状态

```java
public class DemoApplication {

    public static void main(String[] args) throws Exception {
        System.out.println(Thread.currentThread().isInterrupted());
        Thread.currentThread().interrupt();
        System.out.println(Thread.currentThread().isInterrupted());
        System.out.println(Thread.currentThread().isInterrupted());
    }

}
```

控制台输出

```
false
true
true
```

由于一开始我没有设置主线程的中断状态，所以第一次输出为false，然后第二次我显示的设置主线程为中断状态，结果输出true，最后再次打印主线程的中断状态，输出true，说明该方法不会改变线程中断状态

### `private native boolean isInterrupted(boolean ClearInterrupted)`

改方法是Thread实例的native方法，2和3的两个方法最终调用的都是这个方法，只是传入的参数不一样，它本质上也是返回当前线程的中断状态，但是它有一个布尔类型的参数ClearInterrupted它会根据传入的参数true或false来重置线程的中断状态，也就是说如果某个线程处于中断状态，并且调用了该方法传入参数为true，那么该方法返回值为true，但最终该线程的中断状态被重置为false了


## sleep方法

sleep方法意为睡眠的意思，它的作用是让当前的线程暂停执行指定的毫秒数。注意当前线程不会丢失对象的monitor。Thread类中一共定义了两个sleep方法

```java
public static native void sleep(long millis) throws InterruptedException;

public static void sleep(long millis, int nanos)
    throws InterruptedException {
    if (millis < 0) {
        throw new IllegalArgumentException("timeout value is negative");
    }

    if (nanos < 0 || nanos > 999999) {
        throw new IllegalArgumentException(
            "nanosecond timeout value out of range");
    }
    if (nanos >= 500000 || (nanos != 0 && millis == 0)) {
        millis++;
    }

    sleep(millis);
}
```

在本版本中，sleep(long millis, int nanos) 校验 nanos 位于 0 到 999999，再将达到半毫秒的余量，或 millis 为零时的非零余量，向毫秒进位后委托给 native sleep。计时精度和恢复执行受调度影响。sleep 不释放当前线程已持有的任何监视器。

## join方法

join意为加入、插队的意思，它的作用是让多个并行运行的线程变为串行运行。在Thread中一共定义了三个join相关的方法

```java
public final void join() throws InterruptedException {...}

public final synchronized void join(long millis) throws InterruptedException {...}

public final synchronized void join(long millis, int nanos) throws InterruptedException {...}
```

从源码中我们可以发现三个join方法我们可以发现本质上它们最终都调用了第二个join方法，所以我们只需要分析这个方法即可，先看一个简单的例子

```java
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

控制台输出

```
2
1
```

无超时的 worker.join 等待 worker 终止；等待的是目标线程，不是执行 join 调用的主线程。主线程也可能因中断提前退出等待。下面的实现通过反复检查 worker 是否存活来应对通知和虚假唤醒。

```java
public final synchronized void join(long millis)
throws InterruptedException {
    long base = System.currentTimeMillis();
    long now = 0;

    if (millis < 0) {
        throw new IllegalArgumentException("timeout value is negative");
    }

    if (millis == 0) {
        while (isAlive()) {
            wait(0);
        }
    } else {
        while (isAlive()) {
            long delay = millis - now;
            if (delay <= 0) {
                break;
            }
            wait(delay);
            now = System.currentTimeMillis() - base;
        }
    }
}
```

其实它是通过Object的wait方法来实现的，如果我们调用join()方法，那么默认传入的参数就是0毫秒，就会进入下面的if分支

```java
while (isAlive()) {
	wait(0);
}
```

第一步先判断执行该方法的线程是否存活，如果目标线程尚未启动，join 会直接返回；要等待它的执行结束，通常先 start 再 join。然后调用wait(0)方法，注意这里有一个很容易混淆的概念，这个join方法我们是在主线程中调用的，虽然执行的对象是另一个worker，但是执行的时机是在主线程的中的，也就是说在执行这个wait(0)方法的时候，其实是主线程在执行。**记住是主线程在执行**。我们再回头看一下这个方法的签名，发现它是被`synchronized`关键字修饰的，也就是说**主线程执行worker.join()方法后，就获得了worker对象的monitor**，然后此时调用wait(0)方法其实就是this.wait(0)，这个this就是worker对象。根据wait方法的注释可以得知，拥有对象monitor的线程调用对象的wait方法将会导致该线程处于WAITING状态，而如果参数为0的话，那么该线程就会一直处于WAITING状态，除非其它拥有该对象monitor的线程调用 notify()或者 notifyAll() 方法才能唤醒该线程。这就是为什么主线程会被阻塞的原因。
还有一个问题就是主线程是什么时候被唤醒的？从上面代码执行的结果来看，在worker线程执行完毕后，主线程就接着执行了，难道是worker线程销毁时唤醒被阻塞线程的吗？对，没错。从网上查阅资料可以得知，线程在退出时，jvm会把阻塞在该线程上的其它线程都唤醒，类似于在即将退出的线程上调用了notifyAll()方法，当然啦join方法的注释上也说明了当一个线程终止时，将调用this.notifyAll方法。

如果我们为join方法指定了毫秒值，就会进入这个if分支

```java
while (isAlive()) {
    long delay = millis - now;
    if (delay <= 0) {
        break;
    }
    wait(delay);
    now = System.currentTimeMillis() - base;
}
```

可以发现它和毫秒值为0的逻辑一样，依旧是调用的wait方法来阻塞主线程，只不过是调用了带毫秒值的wait方法，经过指定时间后，主线程就会被自动唤醒，还是上面那个例子，我们为join方法添加参数

```java
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

控制台输出

```
1
2
```

果然主线程在阻塞1秒后开始运行了

## yield方法

yield 是给调度器的让步提示，调度器可以忽略它。线程仍处于 RUNNABLE，调用不保证其他线程先运行，也不提供内存同步或业务顺序保证。

```java
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
                yield();
            }
            System.out.println(getName() + "执行结束");
        }
    }
}
```

执行以上代码控制台输出

```
YieldThread1开始执行
YieldThread2开始执行
YieldThread1让出cpu执行权
YieldThread2执行结束
YieldThread1执行结束
```

输出结果是不确定的，因为可能第一次运行的线程是YieldThread1，它让出了cpu执行权，然后cpu开始调度，此时依旧可能选中YieldThread1，它就会执行完剩余的代码，所以我们不能依赖该方法控制线程的执行顺序。

## Object类中和线程相关的方法

在java中，每个对象都拥有一个对象锁，通常我们称其为对象monitor，只有拥有对象monitor的线程才能访问这个对象被同步的代码，所以这就是下文即将介绍的wait，notify方法为什么定义在Object类中而不是定义在Thread中的原因。**因为每个对象都有一个monitor。**

### wait方法

wait意为等待的意思，它的作用是让拥有某个对象monitor的线程阻塞并处于WAITING状态，也就是说调用该方法的线程必须拥有这个对象的monitor（通常是执行了某个对象的synchronized方法或者synchronized代码块），否则会抛出IllegalMonitorStateException异常。注意该方法和Thread类中的sleep方法有一点区别，线程执行sleep方法后不会丢失对象的monitor，而执行wait方法的线程会丢失该对象的monitor。在Object类中一共定义了三个和wait相关的方法。

```java
// 一直阻塞当前线程，直到其它线程调用对象的 notify() 或者notifyAll() 方法
public final void wait() throws InterruptedException {...}

public final native void wait(long timeout) throws InterruptedException;
// 阻塞当前线程，直到其它线程调用对象的 notify() 或者notifyAll() 方法或者已经过了指定的时间量
public final void wait(long timeout, int nanos) throws InterruptedException {...}
```

### notify方法

notify意为通知的意思，它的作用是唤醒正在此对象monitor上等待的线程，这些线程指的是上面调用了wait方法的线程，一般来说wait方法和notify方法是成对出现的。在Object类中一共定义了两个和notify相关的方法。

```java
// 选择正在此对象监视器上等待的一个线程，不保证选择顺序
public final native void notify();
// 唤醒正在此对象monitor上等待的所有线程
public final native void notifyAll();
```

这两个方法仅仅是用来唤醒由于调用了wait方法处于WAITING状态的线程，唤醒它们后，这些线程不一定会立马执行，是否能够继续执行取决于cpu的调度。下面的例子给出了wait和notify配合使用的场景

```java
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

控制台输出

```
Worker开始运行: 2019-07-10T19:26:55.799
Worker结束运行: 2019-07-10T19:26:57.739
```

在主线程中开启一个Worker线程，在子线程的run方法内同步一个对象lock，所以子线程执行run后就会获取lock的monitor，然后lock执行wait方法，Worker线程就会阻塞并处于WAITING状态，并且失去lock的monitor。
主线程在同一监视器保护下设置 ready 并通知等待者。即使通知先发生，Worker 也会根据 ready 跳过等待；发生虚假唤醒时继续检查条件。主线程退出 synchronized 后，Worker 才能重新取得监视器并继续。sleep 只用于演示时间间隔，不承担正确性保障。

## setUncaughtExceptionHandler方法

该方法是用来设置当前线程由于未捕获的异常而突然终止时调用的处理程序。如果没有设置这样的处理程序，则线程所属的ThreadGroup对象充当其处理程序。从方法的注释上我们可以得出以上信息。也就是说默认情况下线程抛出运行时异常是由所属的ThreadGroup处理的。在ThreadGroup的类定义上我们可以发现它的确实现了Thread.UncaughtExceptionHandler接口，我们来看一下ThreadGroup中的处理异常的逻辑

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

ThreadGroup.uncaughtException 先委托父线程组。到达没有父组的根组后，才检查通过 Thread.setDefaultUncaughtExceptionHandler 设置的默认处理器；没有默认处理器且异常不是 ThreadDeath 时，将信息打印到标准错误流。线程实例自己的处理器优先于所属线程组。

```java
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

在上面例子中首先给worker线程设置了一个异常处理器，然后再给所有线程设置了默认的线程处理器，worker线程运行期间会抛出一个ArithmeticException异常，最终控制台打印**线程实例的异常处理器**，如果不设置worker线程异常处理器，那么控制台将打印**所有线程的异常处理器**。当然啦我们也可以继承ThreadGroup重写它的uncaughtException方法，创建线程时指定线程的ThreadGroup为我们自定义的ThreadGroup，就可以统一处理线程组里面的所有线程抛出的异常了。

## 总结

本文主要介绍了线程相关的一些常用的方法，理解这些方法背后的原理能够让我们更加清晰线程执行的流程。

## 资料来源

- [Thread：interrupt、sleep 与 join](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
- [Object：wait 与 notify](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html)
