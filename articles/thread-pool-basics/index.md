---
title: "ThreadPoolExecutor 概述"
date: 2020-01-07
updated: 2026-10-03
tags:
  - Java
  - Concurrent
  - ThreadPoolExecutor
  - ThreadPoolExecutor概述
domain: Java
---

ThreadPoolExecutor 的行为由线程数量、任务队列和拒绝策略共同决定。maximumPoolSize 很大，不意味着任务积压时一定增加线程；队列可以一直接纳时，任务通常继续排队。配置线程池应先明确过载时希望调用者看到什么。

本文以 Java SE 25 的公开契约解释配置选择，再对照 [OpenJDK 8u202-b08 的状态编码](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/concurrent/ThreadPoolExecutor.java)。这里的数值例子是接纳规则推演，不是吞吐量实验；源码摘录不是可独立运行的自制线程池。

## 一次提交经过哪三个接纳阶段

1. 工作线程数小于 corePoolSize：先尝试创建线程执行本次任务，即使其他线程可能空闲。
2. 第一步未接纳且线程池仍运行：尝试将任务加入队列。
3. 不能入队：尝试增加线程，但不能超过 maximumPoolSize；仍不能接纳则交给 RejectedExecutionHandler。

等于 corePoolSize 时已经进入入队阶段，不必先超过核心数量。线程工厂创建失败、池并发关闭等也可能影响结果；完整的状态复查与回退见 [执行原理](/thread-pool-internals/)。

## 用一个容量例子理解扩容

设 corePoolSize=2、maximumPoolSize=4、队列容量为 2。假设先前接纳的任务都尚未结束、没有并发关闭或线程创建失败，顺序提交的去向为：

| 第几项 | 接纳位置 |
| --- | --- |
| 1、2 | 分别创建工作线程直接执行 |
| 3、4 | 进入队列 |
| 5、6 | 队列已满，分别再创建工作线程 |
| 7 | 无法再排队或增加线程，触发拒绝策略 |

后提交的第 5 项可以比队列里的第 3 项更早开始，所以有界队列并不自动提供全局提交顺序保证。若任务已结束，表中后续结果会改变；这些前提不能省略。

## 队列决定你把压力放在哪里

| 队列策略 | 典型行为 | 必须考虑的代价 |
| --- | --- | --- |
| 无界队列 | 核心线程之外的任务继续积压 | maximumPoolSize 通常不参与扩容，内存与排队延迟可能增长 |
| 有界队列 | 排队到容量后尝试扩容 | 容量、最大线程数与拒绝需要一起确定 |
| 直接交接队列 | 没有可立即接收的线程时难以排队 | 更容易创建线程或拒绝，不能假定有缓存容量 |

容量不能仅按机器内存能放多少任务来设置，还要考虑任务等待多久仍有业务价值。线程数则结合 CPU 工作、阻塞比例和下游资源上限评估，不存在适用于所有服务的固定公式。

## keepAliveTime 与“核心线程”不是固定身份

corePoolSize 是数量阈值，默认按需创建，也可以预启动。默认只有超出核心数量的空闲 Worker 使用 keepAliveTime 退出；允许 allowCoreThreadTimeOut 后，低于核心数量的线程也可以空闲超时。

Worker 没有永久的核心标记，是否使用定时取任务由当时数量和配置决定。把某个线程称为“最早创建的核心线程，所以永远不会退出”不符合这个模型。

ThreadFactory 决定线程名称、守护属性及异常处理等创建条件。沿用默认工厂与自定义工厂都需要理解实际行为；创建出的线程并不自动携带每次提交者的 ThreadLocal 上下文。

## 拒绝策略是业务行为，不是配置装饰

| 策略 | 饱和时的行为 | 关闭后的关键边界 |
| --- | --- | --- |
| AbortPolicy | 抛 RejectedExecutionException | 仍报告拒绝 |
| CallerRunsPolicy | 由提交线程执行，可能使提交调用变慢 | 池已关闭时不执行 |
| DiscardPolicy | 静默丢弃 | 同样丢弃 |
| DiscardOldestPolicy | 从队头移除一项，再尝试提交 | 池已关闭时不重试 |

队头是否为“最早提交”取决于队列排序，优先级队列不满足这个等同关系。静默丢弃还可能让调用者持有的结果句柄无法按期待完成，因此不能只为了避免异常就选择丢弃。

拒绝发生在接纳阶段，重试可能放大过载。需要重试时应明确时限、次数和调用者负担，不能把无限重试当作保证不丢任务的通用办法。

## 关闭请求与彻底终止要分开

| 状态 | 接收新任务 | 处理排队任务 | 已开始任务 |
| --- | --- | --- | --- |
| RUNNING | 是 | 是 | 正常执行 |
| SHUTDOWN | 否 | 是 | 正常执行 |
| STOP | 否 | 否 | 尝试中断 |
| TIDYING | 否 | 无 | 准备执行终止钩子 |
| TERMINATED | 否 | 无 | 终止已完成 |

shutdown 请求有序关闭，shutdownNow 尝试停止并返回尚未开始的任务；二者都不能强制完成忽略中断的业务代码。awaitTermination 等待终止或超时，本身不会发出关闭请求。

Java 8 的 ctl 将这些状态放在 int 高 3 位，低 29 位保存 Worker 计数。打包让一次 CAS 可以维护相关状态，但其位布局是具体实现细节；使用线程池时依赖公开契约即可。

## 资料来源

- [ThreadPoolExecutor：队列、线程工厂与拒绝策略](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)
- [ExecutorService：提交、关闭与等待](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html)
- [任务接纳、Worker 与终止的源码路径](/thread-pool-internals/)
