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

假设要写一个容量固定的任务队列。队列满了，`offer(task)` 返回 `false`，`add(task)` 却要抛异常；队列空了，`poll()` 返回 `null`，`remove()` 又要抛异常。这些方法操作的是同一份数据，分别实现很容易让行为不一致。

`AbstractQueue` 把其中重复的部分做成了骨架：子类决定元素怎样存取，父类根据基础操作的结果，补齐异常形式和批量操作。它能省掉哪些工作，以及哪些工作仍然要自己做，可以沿着这个任务队列来看。

本文按 Java SE 25 的公开 API 说明；代码是方法摘录，不是一份可直接编译的队列。完整实现见 [JDK 25 AbstractQueue](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/util/AbstractQueue.java)。

## 子类提供存储，骨架转换失败形式

一个典型子类需要实现 offer、poll、peek，并提供 Collection 所需的 iterator、size 等能力。AbstractQueue 不维护元素数组、链表、容量或锁，也不会因为继承了它而自动获得线程安全。

### 一次存取，两种失败表达

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

### 为什么基础操作不能接受 null

假如任务队列允许存入 `null`，`poll()` 返回 `null` 时，父类就无法判断它取出了一个元素，还是队列已经空了。`remove()` 可能把一次成功取出误判为失败，`clear()` 也可能提前结束。因此，这个骨架要求子类禁止 `null`；这条约定支撑着上面所有方法之间的转换。

## 批量方法仍然由单次操作组成

基础操作正确之后，父类就能用它们完成清空和批量添加。不过，调用一次批量方法，并不意味着所有元素在同一个不可分割的步骤里改变。

### clear 通过不断 poll 清空

```java
public void clear() {
    while (poll() != null)
        ;
}
```

clear 不直接访问子类存储，而是持续移除队头，直到 poll 返回 null。因此它的成本和并发行为取决于子类；不是一次原子替换内部容器，也不承诺与并发新增互斥。

### addAll 可能部分成功

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

回到任务队列：它还剩两个空位，现在调用 `addAll(List.of(a, b, c))`。`a`、`b` 依次进入队列，添加 `c` 时 `offer` 返回 `false`，随后 `add` 抛出异常。此时队列已经多了两个任务。调用者若直接重试整个列表，还可能再次提交 `a` 和 `b`；应先决定业务是否允许部分接纳，再选择批量接口。

## 什么时候适合继承

自定义存储正好满足这些基础操作和 null 约定时，骨架能统一方法之间的关系。若已有 ArrayDeque、优先级队列或阻塞队列满足需求，直接使用现有实现更容易维护。需要事务式批量插入或特殊并发契约时，应明确实现额外语义，不能依赖 addAll 的名称推断。

## 资料来源

- [AbstractQueue：骨架前提与 addAll 边界](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/AbstractQueue.html)
- [Queue 的基本操作选择](/queue/)
