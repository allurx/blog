---
title: FutureTask
date: 2019-12-28
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - FutureTask
domain: Java
---

FutureTask 连接了两个不同角色：Runnable 提供执行入口，Future 提供结果、失败和取消句柄。创建 FutureTask 不会启动线程，get 也不会替调用者执行任务；普通构造后提交的用法，需要 run 被执行或任务被取消，等待者才可能观察到终止状态；子类还可以通过受保护的完成方法发布结果。

下面先用一个同步执行和一个新线程执行的例子区分这些角色，再按执行、发布、等待和取消分析 [OpenJDK 8u202-b08 源码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/FutureTask.java)。完整用法示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。内部源码仍按 OpenJDK 8u202-b08 研究，不能把旧字段布局当作新版 JDK 的实现承诺。

## 先确定谁执行任务，谁等待结果

[![FutureTask 实现 RunnableFuture，后者组合 Runnable 与 Future](./images/future-task.png)](./images/future-task.png)

保存为 Test.java，执行 `javac -encoding UTF-8 -d out Test.java` 与 `java -cp out io.allurx.Test`。task1 直接 run，业务工作在 main 线程中完成；task2 交给新线程，main 通过 get 等待结果。两项任务的结果分别为 1、2，时间戳随运行变化。

```java
package io.allurx;

import java.time.LocalTime;
import java.util.concurrent.FutureTask;

/**
 * @author allurx
 */
public class Test {

    public static void main(String[] args) throws Exception {

        // 任务1，包装Callable对象
        FutureTask<Person> task1 = new FutureTask<>(() -> {
            System.out.println("开始执行task1：" + LocalTime.now());
            Thread.sleep(2000);
            Person person = new Person();
            person.add(1);
            return person;
        });

        // 任务2，包装Runnable对象
        Person person = new Person();
        FutureTask<Person> task2 = new FutureTask<>(() -> {
            System.out.println("开始执行task2：" + LocalTime.now());
            try {
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("任务在等待期间被中断", e);
            }
            person.add(2);
        }, person);


        // 直接调用FutureTask的run方法，注意这种使用方式阻塞的是当前执行线程，
        // 也就是main线程，实际使用中应该使用线程池或者通过new Thread(java.lang.Runnable)
        // 这种方式来提交任务，不然的话异步任务就没有“异步的意义”了
        task1.run();

        int num1 = task1.get().num;
        System.out.println("task1执行完毕：" + LocalTime.now() + "：结果：" + num1);

        // 执行任务2，也可以将这个任务提交给线程池，本质上是一样的
        new Thread(task2).start();

        int num2 = task2.get().num;
        System.out.println("task2执行完毕：" + LocalTime.now() + "：结果：" + num2);
    }

    static class Person {

        int num;

        void add(int n) {
            num += n;
        }
    }

}
```

Callable 自己返回结果；Runnable 没有返回值，因此另一个构造器使用调用者给定的 result 对象。示例中任务修改这个对象，get 正常返回后读取 num。Future 的内存一致性契约保证任务中的动作对成功取得结果之后的动作可见，不要求给 num 再加 volatile。

## 状态机区分任务执行与结果发布

| 状态 | 含义 |
| --- | --- |
| NEW | 尚未完成；任务可能未启动，也可能正在执行 |
| COMPLETING | 正在发布结果或异常的过渡阶段 |
| NORMAL | 正常结果已发布 |
| EXCEPTIONAL | 异常结果已发布 |
| CANCELLED | 取消成功，未请求中断 |
| INTERRUPTING / INTERRUPTED | 取消路径正在发送或已完成中断请求 |

转换只沿下面的方向发生，不会把已经完成的 FutureTask 再改回 NEW：

```text
NEW → COMPLETING → NORMAL
NEW → COMPLETING → EXCEPTIONAL
NEW → CANCELLED
NEW → INTERRUPTING → INTERRUPTED
```

state 是 volatile；outcome 存放正常值或异常；runner 记录执行线程；waiters 是等待 get 的线程构成的单向栈。把 NEW 解释成“任务尚未开始”会直接误解运行中取消的行为。

## run：同一个任务体最多由一个执行者进入

run 同时检查 state 和 runner。CAS 设置 runner 防止两个线程同时执行任务体；随后再次检查 NEW，避免与取消竞争后仍无条件调用业务代码。

```java
public void run() {
    if (state != NEW ||
        !UNSAFE.compareAndSwapObject(this, runnerOffset,
                                     null, Thread.currentThread()))
        return;
    try {
        Callable<V> c = callable;
        if (c != null && state == NEW) {
            V result;
            boolean ran;
            try {
                result = c.call();
                ran = true;
            } catch (Throwable ex) {
                result = null;
                ran = false;
                setException(ex);
            }
            if (ran)
                set(result);
        }
    } finally {
        runner = null;
        int s = state;
        if (s >= INTERRUPTING)
            handlePossibleCancellationInterrupt(s);
    }
}
```

任务正常返回进入 set，抛出 Throwable 进入 setException。两条路径都先尝试把 NEW 改为 COMPLETING，取得发布资格后写 outcome，再发布最终状态并执行 finishCompletion。若取消已经赢得状态转换，set 不会覆盖取消结果。

```java
protected void set(V v) {
    if (UNSAFE.compareAndSwapInt(this, stateOffset, NEW, COMPLETING)) {
        outcome = v;
        UNSAFE.putOrderedInt(this, stateOffset, NORMAL); // final state
        finishCompletion();
    }
}
```

run 的 finally 清空 runner，并与正在发送的取消中断协调。这里的运行线程可以来自普通 Thread，也可以来自线程池；FutureTask 控制的是一次任务，不是线程的整个生命周期。

## get：等待终止状态，再解释 outcome

get 先读取状态；NEW 或 COMPLETING 还不能报告最终结果，因此进入 awaitDone。多个线程等待同一个 FutureTask 是正常用法。

```java
public V get() throws InterruptedException, ExecutionException {
    int s = state;
    if (s <= COMPLETING)
        s = awaitDone(false, 0L);
    return report(s);
}
```

awaitDone 的循环依次处理：调用者中断、已终止状态、COMPLETING 发布窗口、构造并 CAS 压入 WaitNode，最后才 park 或 parkNanos。唤醒后重新读取 state，不能因为 park 返回就直接读取 outcome。

finishCompletion 原子地取走等待者栈，为每个等待线程 unpark，随后调用 done 钩子并清除 callable 引用。等待者可能在不同时间重新获得 CPU；结果不会因“先唤醒谁”而改变。

```java
private V report(int s) throws ExecutionException {
    Object x = outcome;
    if (s == NORMAL)
        return (V)x;
    if (s >= CANCELLED)
        throw new CancellationException();
    throw new ExecutionException((Throwable)x);
}
```

| get 的结果 | 调用者应理解的事实 |
| --- | --- |
| 正常返回 | 本次任务的结果已发布 |
| ExecutionException | 任务失败，原异常保存在 cause |
| CancellationException | Future 已取消，不表示业务副作用已撤销 |
| TimeoutException | 带超时 get 没有等到结果，不会自动取消任务 |
| InterruptedException | 等待结果的线程被中断，不等于执行任务的线程被中断 |

## cancel：Future 的取消与业务停止是两件事

cancel 只有在成功把 NEW 改为取消状态时才返回 true。由于 NEW 包含执行中的任务，cancel(false) 可以在任务已开始后成功；执行中的业务代码可以继续，但 get 将报告 CancellationException。

```java
public boolean cancel(boolean mayInterruptIfRunning) {
    if (!(state == NEW &&
          UNSAFE.compareAndSwapInt(this, stateOffset, NEW,
                                   mayInterruptIfRunning ? INTERRUPTING : CANCELLED)))
        return false;
    try {
        if (mayInterruptIfRunning) {
            try {
                Thread t = runner;
                if (t != null)
                    t.interrupt();
            } finally {
                UNSAFE.putOrderedInt(this, stateOffset, INTERRUPTED);
            }
        }
    } finally {
        finishCompletion();
    }
    return true;
}
```

mayInterruptIfRunning 为 true 时请求中断 runner。中断是协作机制：任务阻塞在可中断操作时可能退出，纯计算或忽略中断的代码仍可能继续。成功取消也不回滚已经发送的请求、写入的文件或其他业务副作用。已完成状态下的失败取消直接返回 false。

## runAndReset 为什么适合周期任务

runAndReset 执行 callable，但正常完成时不发布结果，仍保留 NEW，返回是否具备再次执行的条件。异常会进入异常完成，取消也会使其不能继续。这不是一般调用者的重试 API，而是供 [ScheduledThreadPoolExecutor](/scheduled-thread-pool/) 等内部周期协议使用的受保护入口。

周期任务的 get 因此不会在每轮正常结束时返回。业务若需要每轮结果，应另外安排明确的结果通道，不能把一个周期 Future 当作不断刷新的返回值容器。

## 资料来源

- [OpenJDK 8u202-b08 FutureTask：含等待、移除等待者与重置的完整实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/FutureTask.java)
- [FutureTask 公共契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/FutureTask.html)
- [Future 的完成、取消与内存一致性](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html)
