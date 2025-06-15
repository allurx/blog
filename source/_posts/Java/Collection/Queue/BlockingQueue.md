---
title: BlockingQueue
date: 2020-01-03
categories:
- Java
- Collection
- Queue
- BlockingQueue
- BlockingQueue定义
tags:
- Java
- Collection
- Queue
- BlockingQueue
---

# 概述

BlockingQueue是Queue的一种，它的设计目的在于往队列中新增或者获取元素时提供阻塞的需求，例如常见的生产者-消费者模式。生产者往队列中添加元素时如果队列已经满了，那么就会阻塞当前线程直到队列空间变成可用为止。消费者从队列中获取元素时如果队列为空那么就会阻塞当前线程直到队列不为空为止。BlockingQueue中的方法对于特定的操作会有以下四种情况：抛出异常、返回特殊值（null或false，具体取决于操作），无限期地阻塞当前线程直到操作成功为止、在给定的最大时间限制内放弃操作。

<!-- more -->

# 方法定义

## 新增方法

### boolean add(E e)

重写了Queue中add方法，add方法如果可以立即将指定的元素插入此队列中，同时不会违反容量限制，则在成功时返回true，**如果当前队列没有可用空间，则抛出IllegalStateException。**

### boolean offer(E e)

offer方法同样是往队列中添加元素，只有在不会违反容量限制时，成功插入队列则返回true。与add方法的不同之处在于如果容量已经满了offer方法仅仅返回false而不会抛出异常。

### void put(E e) throws InterruptedException

put方法同样是往队列中添加元素，只不过如果当前队列已满时会阻塞当前线程直到队列空间可用为止。

### boolean offer(E e, long timeout, TimeUnit unit) throws InterruptedException

offer方法同样是往队列中添加元素，与put方法不同之处在于如果当前队列已满时会使当前线程阻塞指定的时长，如果指定时长后队列依旧是满的，那么则返回false。

## 删除方法

###  E take() throws InterruptedException

获取队列中的头部元素。如果队列为空则阻塞直到队列不为空为止。

### E poll(long timeout, TimeUnit unit) throws InterruptedException

获取队列中的头部元素。如果队列为空会使当前线程阻塞指定的时长，如果指定时长后队列依旧为空，那么则返回null。

### boolean remove(Object o)

从队列中删除指定元素的单个实例（如果存在）。 即如果队列包含一个或多个这样的元素满足`o.equals（e）`则删除元素e。 

## 获取方法

BlockingQueue中的获取方法使用的是Queue接口中定义的`E element()`和`E peek()`方法，方法含义保持一致。

## 其它方法

### int remainingCapacity()

返回当前队列理想情况下（在没有内存或资源限制的情况下）可以无阻塞接受的其他元素的数目，如果没有内部限制，则返回Integer.MAX_VALUE。需要注意的是不要通过检查剩余容量来判断是否能够插入元素，因为此时可能存在另一个线程正在执行插入或删除元素的情况。

### boolean contains(Object o)

重写了Collection中的contains方法，因为大多数集合中是允许包含null元素的，而Queue通常情况下是不允许存在null元素的，所以重新定义了contains方法。

### int drainTo(Collection<? super E> c)

将队列中所有元素删除并移动到指定的集合c中

### int drainTo(Collection<? super E> c, int maxElements)

删除队列中最多maxElements数量个元素并将这些元素移动到指定的集合c中

# 方法汇总

BlockingQueue中的新增、删除、获取元素的方法汇总如下，其中有些方法是定义在Queue接口中的。

<table BORDER CELLPADDING=3 CELLSPACING=1>
  <caption>阻塞队列方法汇总</caption>
  <tr>
    <td></td>
    <td ALIGN=CENTER>
      队列已满或者元素不存在时会抛出异常
    </td>
    <td ALIGN=CENTER>
      队列已满或者元素不存在时只返回特定的值
    </td>
    <td ALIGN=CENTER>
      队列已满或者为空则会阻塞当前线程
    </td>
    <td ALIGN=CENTER>
      队列已满或者为空则会阻塞当前线程直到超时
    </td>
  </tr>
  <tr>
    <td>
      <b>新增</b>
    </td>
    <td>add(e)</td>
    <td>offer(e)</td>
    <td>put(e)</td>
    <td>offer(e, time, unit)</td></tr>
  <tr>
    <td>
      <b>删除</b>
    </td>
    <td>remove()</td>
    <td>poll()</td>
    <td>take()</td>
    <td>poll(time, unit)</td></tr>
  <tr>
    <td>
      <b>获取</b>
    </td>
    <td>element()</td>
    <td>peek()</td>
    <td>
      不适用
    </td>
    <td>
      不适用
    </td>
  </tr>
</table>

# 例子

BlockingQueue的注释上给出了一个基于生产者-消费者的阻塞队列经典使用场景。伪代码如下：

```java
// 生产者
class Producer implements Runnable {
    private final BlockingQueue queue;
    Producer(BlockingQueue q) { queue = q; }
    public void run() {
        try {
            while (true) { queue.put(produce()); }
        } catch (InterruptedException ex) { ... handle ...}
    }
    Object produce() { ... }
}
// 消费者
class Consumer implements Runnable {
    private final BlockingQueue queue;
    Consumer(BlockingQueue q) { queue = q; }
    public void run() {
        try {
            while (true) { consume(queue.take()); }
        } catch (InterruptedException ex) { ... handle ...}
    }
    void consume(Object x) { ... }
}

// 使用
class Setup {
    void main() {
        BlockingQueue q = new SomeQueueImplementation();
        Producer p = new Producer(q);
        Consumer c1 = new Consumer(q);
        Consumer c2 = new Consumer(q);
        new Thread(p).start();
        new Thread(c1).start();
        new Thread(c2).start();
    }
}
```

上面的伪代码中Producer和Consumer共用一个BlockingQueue，Producer通过`while (true)`不停的使用`put(e)`方法（队列已满时则会阻塞当前线程）往队列中新增元素，Consumer通过`while (true)`不停的使用`take()`方法（队列为空则阻塞当前线程）从队列中取元素。一个很典型的阻塞队列使用例子。

# 总结

BlockingQueue是Queue的一种，它的设计目的在于往队列中新增或者获取元素时提供阻塞的需求，例如常见的生产者-消费者模式。生产者往队列中添加元素时如果队列已经满了，那么就会阻塞当前线程直到队列空间变成可用为止。消费者从队列中获取元素时如果队列为空那么就会阻塞当前线程直到队列不为空为止。