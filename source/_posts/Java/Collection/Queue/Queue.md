---
title: Queue
date: 2020-01-03
categories:
- Java
- Collection
- Queue
- Queue定义
tags:
- Java
- Collection
- Queue
---

# 概述

Queue是一种数据结构，它的设计目的在于处理任务之前先将任务有序的放到这种数据结构中（Queue），所以队列通常情况下是以FIFO（先进先出）的方式对元素进行排序（但不一定也有特殊的队列，例如优先级队列是通过comparator对元素进行排序的，或者是LIFO队列，即后进先出的队列）。Queue继承了Collection接口，所以队列也是java集合框架的一部分。同时Queue提供了不同于Collection接口中的新增，删除，获取这些语义的方法，这些方法中的每一种都以两种形式存在：一种在操作失败时引发异常，另一种返回特殊值（取决于操作，返回null或false）。

<!-- more -->

# 方法定义

Queue中定义了一些与java集合框架中新增、删除、获取语义相同但实现不同的方法，下面我们就来看一看这些方法的含义。

## 新增方法

### boolean add(E e)

重写了Collection中add方法，add方法如果可以立即将指定的元素插入此队列中，同时不会违反容量限制，则在成功时返回true，**如果当前队列没有可用空间，则抛出IllegalStateException。**

### boolean offer(E e)

offer方法同样是往队列中添加元素，只有在不会违反容量限制时，成功插入队列则返回true。**与add方法的不同之处在于如果容量已经满了offer方法仅仅返回false而不会抛出异常。**

## 删除方法

### E remove()

删除并返回队列中的头部元素。 **如果队列为空，则会抛出NoSuchElementException**。

### E poll()

poll方法同样是删除并返回队列中的头部元素。与remove方法的不同之处在于，**如果此时队列为空则会返回null而不会抛出异常。**

## 获取方法

### E element()

获取队列中的头部元素。**如果队列为空则会抛出NoSuchElementException。**

### E peek()

peek方法同样是获取队列中的头部元素。，与element方法的不同之处在于**如果此时队列为空则会返回null而不会抛出异常。**

# 方法汇总

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

# 总结

Queue是java集合框架的一部分，它除了提供基本的“收集元素”功能之外，主要目的是提供一种FIFO（先进先出）的数据结构。当然也存在不是FIFO的队列，这不在本文的探讨之中，但是大部分队列都是FIFO的。同时队列提供了与集合框架中的新增、删除、获取语言相同但执行逻辑不同的6个方法，以便我们在操作无界或者有界队列选择合适的方法。