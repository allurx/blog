---
title: Queue
date: 2020-01-03
updated: 2026-10-02
tags:
  - Java
  - Collection
  - Queue
  - Queue定义
domain: Java
---

`Queue` 为入队、出队、查看队头各提供两类失败处理：`add/remove/element` 抛出异常，`offer/poll/peek` 返回特殊值。队列不必一定按 FIFO 排序，接口也不保证线程安全；调用方应按实现的容量、排序与并发契约选择。

`poll()` 和 `peek()` 的 `null` 用来表示队列为空，因此不宜向队列放入 `null`。阻塞、优先级或并发行为由具体实现或子接口提供，不能仅凭 `Queue` 类型推断。


## 方法定义

Queue中定义了一些与java集合框架中新增、删除、获取语义相同但实现不同的方法，下面我们就来看一看这些方法的含义。

### 新增方法

#### boolean add(E e)

重写了Collection中add方法，add方法如果可以立即将指定的元素插入此队列中，同时不会违反容量限制，则在成功时返回true，**如果当前队列没有可用空间，则抛出IllegalStateException。**

#### boolean offer(E e)

offer方法同样是往队列中添加元素，只有在不会违反容量限制时，成功插入队列则返回true。**与add方法的不同之处在于如果容量已经满了offer方法仅仅返回false而不会抛出异常。**

### 删除方法

#### E remove()

删除并返回队列中的头部元素。 **如果队列为空，则会抛出NoSuchElementException**。

#### E poll()

poll方法同样是删除并返回队列中的头部元素。与remove方法的不同之处在于，**如果此时队列为空则会返回null而不会抛出异常。**

### 获取方法

#### E element()

获取队列中的头部元素。**如果队列为空则会抛出NoSuchElementException。**

#### E peek()

peek方法同样是获取队列中的头部元素。，与element方法的不同之处在于**如果此时队列为空则会返回null而不会抛出异常。**

## 方法汇总

Queue中的新增、删除、获取元素的方法汇总如下

<table BORDER CELLPADDING=3 CELLSPACING=1>
  <caption>队列方法汇总</caption>
  <tr>
    <td></td>
    <td ALIGN=CENTER>
      队列已满或者元素不存在时会抛出异常
    </td>
    <td ALIGN=CENTER>
      队列已满或者元素不存在时只返回特定的值
    </td>
  </tr>
  <tr>
    <td>
      <b>新增</b>
    </td>
    <td>add(e)</td>
    <td>offer(e)</td></tr>
  <tr>
    <td>
      <b>删除</b>
    </td>
    <td>remove()</td>
    <td>poll()</td></tr>
  <tr>
    <td>
      <b>获取</b>
    </td>
    <td>element()</td>
    <td>peek()</td></tr>
</table>

## 总结

Queue是java集合框架的一部分，它除了提供基本的“收集元素”功能之外，主要目的是提供一种FIFO（先进先出）的数据结构。当然也存在不是FIFO的队列，这不在本文的探讨之中，但是大部分队列都是FIFO的。同时队列提供了与集合框架中的新增、删除、获取语言相同但执行逻辑不同的6个方法，以便我们在操作无界或者有界队列选择合适的方法。

## 资料来源

- [Queue：排序与六个基本操作](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html)
