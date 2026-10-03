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

ThreadGroup 把平台线程组织成树，提供枚举、中断和未捕获异常处理等入口。它不是任务完成框架：activeCount 只是估计值，枚举也不是稳定快照，不能靠“组里看起来没有线程”判断全部业务任务已完成。

本文先解释组树和公开操作，再用自定义异常处理器观察线程与组的关系。示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。历史内部实现固定为 [OpenJDK 8u202-b08 ThreadGroup](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ThreadGroup.java)；特别是 destroy 在 Java 8 与当前 JDK 的行为不同。

## 线程组树如何建立

ThreadGroup(String name) 使用当前线程所属组作为父组；另一个公开构造器允许明确传入父组。父组是 ThreadGroup，不是创建者线程对象。创建 Thread 时未显式指定组，平台线程通常继承创建者所属组。

Java 8 内部维护父组、子组数组、活动线程数组以及相关计数，并在 Thread 初始化、启动失败和终止路径上更新关系。当前虚拟线程有专门的线程组，本文示例使用 new Thread 创建的平台线程，不能用它推断虚拟线程的组管理细节。

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

## 未捕获异常怎样找到处理器

线程实例设置了 UncaughtExceptionHandler 时优先交给它；没有专用处理器时，所属线程组承担该入口。默认组实现向父组转发，到根组后使用全局默认处理器；不存在默认处理器时才按实现规则打印到标准错误流。

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

程序依次输出线程名、组、最大优先级、父组、活动数量、祖先判断和枚举数组。最后故意执行 1 / 0，自定义处理器输出 ArithmeticException。这是验证处理器入口的预期异常；Thread.toString 的编号、堆栈行号和标准输出/错误输出的交错不是稳定结果。

## destroy 必须按版本理解

OpenJDK 8u202-b08 的 destroy 要求没有活动线程，递归销毁子组并从父组移除，违反条件会抛异常。Java SE 25 的同名方法已弃用且为空操作，不能拿旧源码给当前应用设计资源回收协议。

线程组适合理解历史 JVM 线程组织和异常分发。新业务中的任务接纳、取消、结果收集和关闭，应采用明确的执行器和完成协议；组树不会自动承担这些职责。

## 资料来源

- [Java SE 25 ThreadGroup：当前行为、估计值与弃用 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadGroup.html)
- [OpenJDK 8u202-b08 ThreadGroup：历史数组维护和 destroy](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ThreadGroup.java)
