---
title: ThreadLocal
date: 2019-07-19
updated: 2026-10-03
tags:
  - Java
  - Thread
  - ThreadLocal
domain: Java
---

处理请求时，代码常把用户信息放入一个 `ThreadLocal`，让调用链深处的方法无需层层传参就能取得它。同一个 `ThreadLocal` 被很多线程共用，为什么读取到的值可以各不相同？

关键在于值存放的位置：每条线程都有自己的 Map，`ThreadLocal` 只是访问这张表的键。沿着这层关系，可以继续解释哈希冲突怎样解决、弱引用清除后为什么仍会留下值，以及线程池里的请求结束时为什么需要清理。

本文从键、值和线程的持有关系出发，再分析线性探测、查找与过期条目清理。源码基线是 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ThreadLocal.java)；末尾哈希程序只依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。

## 值保存在 Thread 中，ThreadLocal 是访问键

Java 8 的 Thread 持有 threadLocals 字段，类型为 ThreadLocal.ThreadLocalMap。ThreadLocal.get/set/remove 先找当前线程的 Map，再用当前 ThreadLocal 实例作为键操作条目。Map 因而不是跨线程共享的全局表，正常访问不需要为不同线程争用同一把锁。

```text
存活线程 → ThreadLocalMap → Entry → value（强引用）
                              └─→ ThreadLocal 键（弱引用）
```

默认 initialValue 返回 null；首次 get 未找到键时调用 initialValue 并建立绑定。set(null) 仍是一个存在的绑定，remove 则删除绑定，后续 get 可以再次调用 initialValue。继承父线程的值由 [InheritableThreadLocal](/inheritable-thread-local/) 使用另一张 Map 处理，普通 ThreadLocal 不自动传播。

## ThreadLocalMap 怎样找到对应的值

这张 Map 使用数组存储条目。先理解冲突后如何寻找空位，后面的 set、get 和删除逻辑就有了共同的基础。

### 冲突后沿数组继续寻找

ThreadLocalMap 用 Entry 数组保存条目，初始长度 16，长度保持为 2 的幂。起始槽位由 threadLocalHashCode & (length - 1) 计算；发生冲突时按步长 1 检查后续槽位，并在数组末尾绕回零。

例如长度为 16 时，哈希值 0、16 或 478700656 的低 4 位都为零，都从槽位 0 开始。相同起始槽位不表示相同键：Map 用键对象身份判断相等，后到的不同键必须继续探测，不能覆盖已有值。

一段从非空槽开始、到第一个空槽结束的连续条目构成探测链。查找遇到空槽就可以停止；因此删除不能简单把中间槽清空，否则位于它后面的键可能再也查不到。

### set：更新、替换或插入

set 的入口取得当前线程 Map，不存在则创建。已有 Map 时执行下面的三个分支：找到同一键便更新值；遇到键已清除的 Entry 交给 replaceStaleEntry；遇到空槽则新建 Entry，再做启发式清理和必要的 rehash。

```java
private void set(ThreadLocal<?> key, Object value) {
    Entry[] tab = table;
    int len = tab.length;
    int i = key.threadLocalHashCode & (len-1);
    for (Entry e = tab[i];
         e != null;
         e = tab[i = nextIndex(i, len)]) {
        ThreadLocal<?> k = e.get();
        if (k == key) {
            e.value = value;
            return;
        }
        if (k == null) {
            replaceStaleEntry(key, value, i);
            return;
        }
    }
    tab[i] = new Entry(key, value);
    int sz = ++size;
    if (!cleanSomeSlots(i, sz) && sz >= threshold)
        rehash();
}
```

size 是实际条目计数，threshold 是扩容判断阈值，不是数组长度。达到阈值前也可能发生过期条目清理；rehash 先清理全表，再根据剩余数量决定是否扩容，不能把每次 set 都理解成固定成本的单次数组赋值。

### get 与 remove：沿探测链找到同一个键

getEntry 先检查理想槽位，未命中再调用 getEntryAfterMiss。探测期间遇到过期条目会清理并重新检查当前位置，因为清理可能把后面的活条目搬过来。

```java
private Entry getEntryAfterMiss(ThreadLocal<?> key, int i, Entry e) {
    Entry[] tab = table;
    int len = tab.length;
    while (e != null) {
        ThreadLocal<?> k = e.get();
        if (k == key)
            return e;
        if (k == null)
            expungeStaleEntry(i);
        else
            i = nextIndex(i, len);
        e = tab[i];
    }
    return null;
}
```

remove 也从理想槽位向后查找，找到同一键后先清除它的弱引用，再调用 expungeStaleEntry。没有找到键则不改变其他绑定。

```java
private void remove(ThreadLocal<?> key) {
    Entry[] tab = table;
    int len = tab.length;
    int i = key.threadLocalHashCode & (len-1);
    for (Entry e = tab[i];
         e != null;
         e = tab[i = nextIndex(i, len)]) {
        if (e.get() == key) {
            e.clear();
            expungeStaleEntry(i);
            return;
        }
    }
}
```

## 删除条目为什么会影响相邻位置

删除除了释放值，还要保证其余键仍然能被找到。这是清理代码比一次数组置空复杂的原因。

### expungeStaleEntry 修复探测链

键被 GC 清除后，Entry 本身与 value 仍可能存活。expungeStaleEntry 先解除给定条目的 value 和数组引用，再扫描后续探测链。过期条目继续删除；活条目重新计算理想槽位，并放入当前链中可达的第一个空位。

```java
private int expungeStaleEntry(int staleSlot) {
    Entry[] tab = table;
    int len = tab.length;
    tab[staleSlot].value = null;
    tab[staleSlot] = null;
    size--;
    Entry e;
    int i;
    for (i = nextIndex(staleSlot, len);
         (e = tab[i]) != null;
         i = nextIndex(i, len)) {
        ThreadLocal<?> k = e.get();
        if (k == null) {
            e.value = null;
            tab[i] = null;
            size--;
        } else {
            int h = k.threadLocalHashCode & (len - 1);
            if (h != i) {
                tab[i] = null;
                while (tab[h] != null)
                    h = nextIndex(h, len);
                tab[h] = e;
            }
        }
    }
    return i;
}
```

假设 A、B 都从槽位 2 开始，A 占了 2，B 只能放在 3。直接清空槽位 2 后，再查找 B 就会在第一个位置看到空槽，误以为 B 不存在。把 B 按剩余结构放回槽位 2，查找才能继续成立。这里的搬移因此关系到正确性，而非只为减少查找次数。

### replaceStaleEntry 先找同一个键，再利用空位

replaceStaleEntry 还处理更微妙的情况：遇到过期槽后，真正的同一键可能已经在它后面。如果不继续查找就插入，会留下两个同一键的条目。该方法先向前找这一段更早的过期槽，再向后寻找目标键；找到则更新并交换位置，找不到才用新条目替换。

```java
private void replaceStaleEntry(ThreadLocal<?> key, Object value,
                               int staleSlot) {
    Entry[] tab = table;
    int len = tab.length;
    Entry e;
    int slotToExpunge = staleSlot;
    for (int i = prevIndex(staleSlot, len);
         (e = tab[i]) != null;
         i = prevIndex(i, len))
        if (e.get() == null)
            slotToExpunge = i;
    for (int i = nextIndex(staleSlot, len);
         (e = tab[i]) != null;
         i = nextIndex(i, len)) {
        ThreadLocal<?> k = e.get();
        if (k == key) {
            e.value = value;
            tab[i] = tab[staleSlot];
            tab[staleSlot] = e;
            if (slotToExpunge == staleSlot)
                slotToExpunge = i;
            cleanSomeSlots(expungeStaleEntry(slotToExpunge), len);
            return;
        }
        if (k == null && slotToExpunge == staleSlot)
            slotToExpunge = i;
    }
    tab[staleSlot].value = null;
    tab[staleSlot] = new Entry(key, value);
    if (slotToExpunge != staleSlot)
        cleanSomeSlots(expungeStaleEntry(slotToExpunge), len);
}
```

### cleanSomeSlots 把清理分摊到访问过程中

cleanSomeSlots 用右移递减扫描预算，遇到过期槽后扩大清理范围。它是启发式扫描，不承诺一次调用清掉整张表的所有过期条目。

```java
private boolean cleanSomeSlots(int i, int n) {
    boolean removed = false;
    Entry[] tab = table;
    int len = tab.length;
    do {
        i = nextIndex(i, len);
        Entry e = tab[i];
        if (e != null && e.get() == null) {
            n = len;
            removed = true;
            i = expungeStaleEntry(i);
        }
    } while ( (n >>>= 1) != 0);
    return removed;
}
```

## 为什么请求结束后仍要 remove

前面的清理方法都需要有代码执行到相应路径。请求结束本身不会通知 Map，也不会触发一次全表清理。

若 ThreadLocal 键失去强引用，GC 可以清除键；但存活线程仍通过 Map 和 Entry 强引用 value。只有清理路径解除条目或线程退出后 Map 不再可达，值才可能解除这条持有链。System.gc 不保证立即发生，也不替 Map 调用 remove。

即使把 ThreadLocal 声明为 static，使键始终可达，线程池中的值也可能跨请求保留。因此业务上真正的边界是绑定结束，而不是“等 GC 发现键消失”。常见模板是：

```java
context.set(requestContext);
try {
    processRequest();
} finally {
    context.remove();
}
```

这是生命周期模板，context、requestContext 与 processRequest 由业务提供，不是独立程序。若存在嵌套作用域且外层绑定需要继续使用，应按协议恢复旧值；不能用无条件 remove 破坏仍有效的外层上下文。

## 0x61c88647 的作用：分散连续创建的键

每个新 ThreadLocal 从一个 AtomicInteger 取得哈希码，并让计数器加上固定步长 0x61c88647。这个数是奇数，与任意 2 的幂互质，所以连续若干次增加后，对长度 2ⁿ 取低 n 位会遍历全部槽位；它减少连续创建键的初始槽位冲突，不保证任意存活键集合永不冲突。

保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`：

```java
package io.allurx;

/**
 * @author allurx
 */
public class DemoApplication {
    private static final int HASH_INCREMENT = 0x61c88647;

    public static void main(String[] args) {
        test(2);
        test(4);
        test(8);
        test(32);
    }

    static void test(int n) {
        for (int i = 0; i < n; i++) {
            int result = (HASH_INCREMENT * i) & (n - 1);
            if (i != n - 1) {
                System.out.print(result + ",");
            } else {
                System.out.println(result);
            }
        }
    }
}
```

```text
0,1
0,3,2,1
0,7,6,5,4,3,2,1
0,7,14,21,28,3,10,17,24,31,6,13,20,27,2,9,16,23,30,5,12,19,26,1,8,15,22,29,4,11,18,25
```

这组实际输出验证了给定容量下的槽位分布。它没有测量 get/set 性能，也不证明弱引用何时被清除。理解算法无需通过反射改写 JDK 私有字段；完整的哈希与清理实现可直接对照固定源码。

## 资料来源

- [OpenJDK 8u202-b08 ThreadLocal：完整 Map、rehash 与 resize 实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ThreadLocal.java)
- [ThreadLocal：初始化、set 与 remove 的公开契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html)
- [WeakReference：弱可达性与清除](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/WeakReference.html)
