---
title: AbstractQueue
date: 2020-01-03
updated: 2026-10-03
tags:
  - Java
  - Collection
  - Queue
  - AbstractQueue
domain: Java
---

AbstractQueue 是 Queue 的骨架实现：子类负责真正的入队、出队、查看和迭代，父类把这些基础操作组合为异常形式与批量操作。理解它，重点是哪些契约被复用，哪些仍由子类承担。

本文按 Java SE 25 的公开 API 说明；代码是方法摘录，不是一份可直接编译的队列。完整实现见 [JDK 25 AbstractQueue](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/util/AbstractQueue.java)。

## 子类提供存储，骨架转换失败形式

一个典型子类需要实现 offer、poll、peek，并提供 Collection 所需的 iterator、size 等能力。AbstractQueue 不维护元素数组、链表、容量或锁，也不会因为继承了它而自动获得线程安全。

| 子类基础操作 | 骨架提供的方法 | 结果转换 |
| --- | --- | --- |
| offer(e) | add(e) | false 转 IllegalStateException |
| poll() | remove() | null 转 NoSuchElementException |
| peek() | element() | null 转 NoSuchElementException |

```java
public boolean add(E e) {
    if (offer(e))
        return true;
    else
        throw new IllegalStateException("Queue full");
}
```

```java
public E remove() {
    E x = poll();
    if (x != null)
        return x;
    else
        throw new NoSuchElementException();
}
```

```java
public E element() {
    E x = peek();
    if (x != null)
        return x;
    else
        throw new NoSuchElementException();
}
```

这套转换依赖 null 表示“没有元素”，因此适用于不允许 null 元素的队列。如果子类对 null 采取不同语义，就必须重新审视是否满足骨架前提，而不是只让类型检查通过。

## clear 通过不断 poll 清空

```java
public void clear() {
    while (poll() != null)
        ;
}
```

clear 不直接访问子类存储，而是持续移除队头，直到 poll 返回 null。因此它的成本和并发行为取决于子类；不是一次原子替换内部容器，也不承诺与并发新增互斥。

## addAll 可能部分成功

```java
public boolean addAll(Collection<? extends E> c) {
    if (c == null)
        throw new NullPointerException();
    if (c == this)
        throw new IllegalArgumentException();
    boolean modified = false;
    for (E e : c)
        if (add(e))
            modified = true;
    return modified;
}
```

null 集合与把队列自身作为来源会被拒绝。其余情况按来源迭代顺序逐个调用 add；若中途容量不足或元素不合法，此前添加的元素不会自动回滚。

例如一个尚有两个空位的有界队列添加三个元素：前两个可以进入，第三个 add 抛异常，方法并不因此恢复原队列。这是批量循环的契约边界，不应在调用层假定“要么全部成功、要么完全没变”。

## 什么时候适合继承

自定义存储正好满足这些基础操作和 null 约定时，骨架能统一方法之间的关系。若已有 ArrayDeque、优先级队列或阻塞队列满足需求，直接使用现有实现更容易维护。需要事务式批量插入或特殊并发契约时，应明确实现额外语义，不能依赖 addAll 的名称推断。

## 资料来源

- [AbstractQueue：骨架前提与 addAll 边界](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/AbstractQueue.html)
- [Queue 的基本操作选择](/queue/)
