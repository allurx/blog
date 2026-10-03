---
title: Queue
date: 2020-01-03
updated: 2026-10-03
tags:
  - Java
  - Collection
  - Queue
  - Queue定义
domain: Java
---

Queue 把一个集合中的“下一项”定义为队头，并为新增、移除队头和查看队头提供两种失败处理方式。选择方法前，要先确定队列怎样排序、是否有容量上限以及操作能否并发。

本文按 Java SE 25 的 Queue 公共契约说明方法选择，不涉及某个实现的内部存储，也没有需要安装依赖的独立程序。

## 队头由实现的顺序规则决定

FIFO 队列的队头通常是最早进入的元素；优先级队列按比较规则决定队头。Queue 本身既不要求所有实现都是 FIFO，也不保证线程安全。变量声明为 Queue，并不能推出底层队列会阻塞、能并发或按插入顺序处理。

例如任务必须按优先级取出，应选合适的优先级实现；只需要两端操作，则应了解 Deque 的契约。不要把“看起来像一个队列”当作容量和顺序设计已经确定。

## 同一种操作有两类失败接口

| 操作 | 异常形式 | 特殊返回值形式 |
| --- | --- | --- |
| 新增元素 | add(e)：容量限制使插入失败时抛 IllegalStateException | offer(e)：无法接纳时返回 false |
| 移除队头 | remove()：空队列抛 NoSuchElementException | poll()：空队列返回 null |
| 查看队头 | element()：空队列抛 NoSuchElementException | peek()：空队列返回 null |

“特殊返回值”只替代相应的容量或空队列失败，不意味着方法不会抛任何异常。元素类型、null 或其他实现限制仍可能使 offer 抛异常。

如果空队列是正常业务分支，poll 通常更直接；如果调用前置条件保证有元素，remove 的异常可以暴露被破坏的约定。选择依据是失败是否属于正常控制流，而不是偏好短名字。

## null 与先检查再操作的两个陷阱

poll、peek 用 null 表示空队列，所以即使某个实现允许存入 null，也不适合依赖这个做法表达业务值；否则调用者无法区分“队列为空”和“队头就是 null”。需要空值语义时，用独立的业务对象表示。

并发环境中，先 isEmpty 再 remove 不是一个原子动作。其他线程可能在两步之间取走元素。应使用与具体并发实现匹配的一次操作，并按返回结果处理，或在共同同步边界内完成检查与修改。

## 接口、骨架与阻塞队列各负责什么

Queue 定义队头及失败契约；[AbstractQueue](/abstract-queue/) 把 offer/poll/peek 的特殊结果转换成异常形式，减少重复实现；[BlockingQueue](/blocking-queue/) 进一步增加等待和超时操作。容量、存储和并发仍由具体实现提供。

## 资料来源

- [Queue：顺序、null 和六个基本操作](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html)
