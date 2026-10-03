---
title: ThreadGroup
date: 2019-07-12
updated: 2026-10-03
tags:
  - Java
  - Thread
  - ThreadGroup
domain: Java
---

排查线程异常时，可能会遇到这样一个现象：没有给线程设置异常处理器，异常却交到了它所属的 `ThreadGroup`。线程组还提供枚举和批量中断入口，不过这些入口各有用途。

本文从组树解释异常如何向上传递，再用一个程序观察这种关系。`activeCount()` 和枚举适合诊断；如果目的是等一批工作完成，需要 `join()` 或执行器的完成协议。

示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。线程组契约以 Java SE 25 API 为准。

## 线程组树如何建立

ThreadGroup(String name) 使用当前线程所属组作为父组；另一个公开构造器允许明确传入父组。父组是 ThreadGroup，不是创建者线程对象。创建 Thread 时未显式指定组，平台线程通常继承创建者所属组。

例如，main 所属组下面新建了 download 组，再以 download 为父组创建 retry 组，这两个组就形成父子关系。线程属于哪个组在创建时确定，创建线程的那段业务代码结束，并不会使组内线程自动结束。

虚拟线程由运行时放入专门的线程组，普通线程组的枚举、计数和组中断不覆盖它们。本文使用 `new Thread` 创建平台线程。

## 枚举结果为什么只能用于观察

| 方法 | 结果与边界 |
| --- | --- |
| activeCount | 当前组及子组活动线程数量的估计值 |
| activeGroupCount | 活动子组数量的估计值，不包含当前组 |
| enumerate(Thread[]) | 将活动线程引用写入给定数组，数组不足会截断 |
| enumerate(ThreadGroup[]) | 写入活动子组，是否递归由重载参数决定 |
| parentOf(group) | 当前组是否为给定组本身或其祖先 |

线程可以在估算数量与枚举之间启动或退出。即使用 activeCount 分配了数组，也不能保证没有截断；数组中剩余位置还可能为 null。监控和诊断可以接受这种近似，但等待已知线程结束应使用 join，等待执行器关闭应使用 awaitTermination。

interrupt 递归请求组内线程中断，不保证业务代码立即退出。中断语义见 [Thread 常用方法](/thread-methods/)，不能把“调用组中断”当作“已销毁组内任务”的证据。

## 异常沿线程与组树寻找处理器

### 实例处理器优先，组负责向上转交

线程实例设置了 UncaughtExceptionHandler 时优先交给它；没有专用处理器时，所属线程组承担该入口。默认组实现向父组转发，到根组后使用全局默认处理器；不存在默认处理器时才按实现规则打印到标准错误流。

### 用一个故意失败的任务观察分发

自定义 ThreadGroup 可以覆盖 uncaughtException。下面同时实现 ThreadFactory，让创建的线程明确加入这个组，避免依赖调用者当前所在组。

保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`。

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

        private int n = 0;

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

程序依次输出线程名、组、最大优先级、父组、活动数量、祖先判断和枚举数组。最后故意执行 1 / 0，自定义处理器输出 ArithmeticException。这是验证处理器入口的预期异常；Thread.toString 的编号、堆栈行号和标准输出/错误输出的交错不是稳定结果。

## 结束任务需要明确的完成协议

Java SE 25 中的 `destroy()` 已弃用且为空操作。要停止示例中的工作，应让任务响应中断或其他停止信号，再等待线程结束。组对象在没有活动线程、且自身也不再可达时可以被回收，不需要靠这个方法销毁。

如果业务需要管理一批任务的接纳、结果与关闭，`ExecutorService` 更适合表达这些需求。线程组提供的是线程组织与异常分发入口；它没有保存“这批订单全部完成”之类的业务状态。

## 资料来源

- [Java SE 25 ThreadGroup：当前行为、估计值与弃用 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadGroup.html)
