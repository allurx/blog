---
title: AbstractQueue
date: 2020-01-03
tags:
  - Java
  - Collection
  - Queue
  - AbstractQueue
domain: Java
---

## 核心结论

`AbstractQueue` 把子类的 `offer/poll/peek` 结果转换成 `add/remove/element` 的异常形式，并提供 `clear()`、`addAll()` 等基本实现。它减少重复代码，但容量、存储、迭代和线程安全仍由子类决定。

## 问题与适用范围

本文回答队列骨架实现如何复用三个基础操作。其默认实现依赖 `null` 表示无元素，适合不允许空元素的队列。`addAll()` 按元素逐个添加，失败前已添加的元素不自动回滚；它也不是一个原子批量操作。

<!-- more -->

## 方法定义

```java
public abstract class AbstractQueue<E>
    extends AbstractCollection<E>
    implements Queue<E> {
 ......
}
```

AbstractQueue定义如上图所示，继承了AbstractCollection提供基本的“收集元素”功能，实现Queue接口，提供 add、remove、element 以及 clear、addAll 等骨架实现，基础存储操作由子类提供

###  boolean add(E e)

```java
public boolean add(E e) {
    if (offer(e))
        return true;
    else
        throw new IllegalStateException("Queue full");
}
```

add方法是基于offer方法来实现的，其中offer方法需要子类来实现，如果offer方法返回false的话说明此时队列以及满了，那么则直接抛出异常，这和Queue中add方法的定义保持一致。

### E element()

```java
public E element() {
    E x = peek();
    if (x != null)
        return x;
    else
        throw new NoSuchElementException();
}
```

element方法是基于peek方法来实现的，其中peek方法需要子类来实现，如果peek方法返回null说明此时队列为空，那么则直接抛出异常，这和Queue中element方法的定义保持一致。

### E remove()

```java
public E remove() {
    E x = poll();
    if (x != null)
        return x;
    else
        throw new NoSuchElementException();
}
```

remove方法是基于poll方法来实现的，其中poll方法需要子类来实现，如果poll方法返回null说明此时队列为空，那么则直接抛出异常，这和Queue中remove方法的定义保持一致。

### void clear()

```java
public void clear() {
    while (poll() != null)
        ;
}
```

clear方法的作用是清空队列中的所有元素，是基于poll方法来实现的，其中poll方法需要子类来实现，如果poll方法返回null说明此时队列为空，因此通过while循环调用poll方法直到队列为空为止。

### boolean addAll(Collection<? extends E> c)

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

addAll方法的作用是将指定Collection中的元素通过迭代的方式全部添加到当前队列中，需要注意的是addAll方法是基于`boolean add(E e)`方法来实现的，AbstractQueue内部默认的add方法实现实在队列已满时会抛出IllegalStateException

## 资料来源

- [AbstractQueue：骨架实现与 addAll 边界](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/AbstractQueue.html)
