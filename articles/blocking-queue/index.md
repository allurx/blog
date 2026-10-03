---
title: BlockingQueue
date: 2020-01-03
updated: 2026-10-03
tags:
  - Java
  - Collection
  - Queue
  - BlockingQueue
  - BlockingQueue定义
domain: Java
---

BlockingQueue 让生产者和消费者通过一个共享队列交接元素，并在“暂时无法插入或取出”时选择立即失败、等待或限时等待。它把等待机制封装进一次操作，但不替业务决定容量、取消和关闭规则。

本文按 Java SE 25 的 BlockingQueue API 说明。基础队头语义见 [Queue](/queue/)；可直接运行的有限生产消费程序在 [LinkedBlockingQueue](/linked-blocking-queue/#用有限任务观察生产与消费)。

## 先选失败方式，再选方法

| 操作 | 异常形式 | 立即返回特殊值 | 等待条件满足 | 最多等待给定时间 |
| --- | --- | --- | --- | --- |
| 插入 | add | offer | put | offer(timeout) |
| 移除队头 | remove | poll | take | poll(timeout) |
| 查看队头 | element | peek | 无此接口 | 无此接口 |

有界队列已满时，put 等待容量或响应中断；take 在空队列上等待元素或响应中断。带超时 offer 失败返回 false，带超时 poll 失败返回 null。超时指定等待预算，不保证线程准点获得 CPU。

异常与特殊值的区别只针对相应失败条件。BlockingQueue 禁止 null 元素，插入 null 仍会失败；接口也不保证所有实现都有相同容量。无界实现的 put 通常不会因为业务容量上限等待，但仍受实际内存限制。

## 容量是生产速度与消费能力之间的约束

生产速度长期高于消费速度时，无界积压不会凭空消失，只会转化为内存占用和等待延迟。有界队列使调用者必须面对接纳失败或等待，业务再决定超时、拒绝、重试或上游减速。

remainingCapacity 只是查询时刻的值。先检查它再 put/offer 之间，其他线程可能改变容量；是否成功应以实际操作结果为准，不能用查询构造一个没有同步保护的保证。

## 队列交接保证可见性，不冻结可变对象

线程在放入元素之前的动作，happens-before 另一个线程随后访问或移除该元素之后的动作。因此消费者能够看到交接前已发布的状态。

这不意味着生产者可以在放入后继续无同步地修改同一个可变对象。后续修改仍需要自己的同步协议；最容易理解的交接方式通常是不可变消息，或明确转移对象所有权。

## 中断、关闭和批量转移是独立边界

put、take 和定时等待可抛 InterruptedException。取消任务时应按所在层的协议退出或传播，不能捕获后无条件无限重试。BlockingQueue 没有统一 close：有限工作、结束标记、外部取消等方式都需要调用者定义，且要考虑生产者和消费者数量。

drainTo 把当前可移出的元素加入目标集合；目标 add 抛异常时，元素可能已经部分转移，接口不提供通用事务回滚。目标集合也必须满足自己的并发要求。remove(Object)、contains 等查询与删除还要遵守具体实现对参数的约束。

## 一个最小生产消费协议

生产者调用 put 交付元素；消费者通过 take 取出并处理。真实程序还需确定何时停止、是否等待消费者结束以及异常由谁报告。下面的伪代码只表达交接位置：

```text
生产者：生成元素 → put → 继续生产
消费者：take → 处理元素 → 继续取出
关闭：按协议发出结束信息或取消，等待参与者退出
```

需要查看容量计数、双锁和条件通知怎样协作，继续阅读 LinkedBlockingQueue 的实现分析；不要把伪代码直接当作已经包含完整关闭逻辑的可运行示例。

## 资料来源

- [BlockingQueue：等待、内存一致性与批量操作](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html)
