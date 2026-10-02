---
title: ThreadLocal
date: 2019-07-19
updated: 2026-10-02
tags:
  - Java
  - Thread
  - ThreadLocal
domain: Java
---

`ThreadLocal` 提供按线程隔离的值访问，但隔离的是绑定关系，不会自动复制可变对象。下面分析的实现中键是弱引用、值仍被条目强引用；在线程池中，线程长期存活且被复用，未清理的值可能滞留或进入下一次业务执行，因此应在绑定的使用边界内调用 `remove()`。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ThreadLocal.java) 分析 ThreadLocalMap 的存储、线性探测与过期条目清理。线程池线程可以处理多个请求，绑定的生命周期应由业务边界控制；跨线程上下文必须显式安排。


## ThreadLocalMap

ThreadLocal是怎么让线程拥有这个变量的呢？通过查看Thread的源码得知原来Thread拥有一个ThreadLocalMap类型的成员变量

```java
ThreadLocal.ThreadLocalMap threadLocals = null;
```

原来我们设置的变量就被保存在这里面，也就是说每个线程都拥有一个ThreadLocalMap成员变量，线程运行期间当然可以直接获取它的成员变量了，然后就能获取我们设置的值了。接下来我们看看这个ThreadLocalMap究竟是个什么东西

### ThreadLocalMap数据结构

ThreadLocalMap是被定义在ThreadLocal内部的静态类。接下来我们看一下这个ThreadLocalMap的定义

```java
static class ThreadLocalMap {
	// 实际存放的对象是被Entry包装的，并且是一个WeakReference
    // 只有键所引用的 ThreadLocal 变为弱可达时，GC 才可能清除该键；值仍可能被 Entry 强引用
    static class Entry extends WeakReference<ThreadLocal<?>> {
		// ThreadLocal对象
        Object value;
		// key为ThreadLocal，value为每个线程要保存的变量
        Entry(ThreadLocal<?> k, Object v) {
            super(k);
            value = v;
        }
    }
	// Entry数组初始化容量为16
    private static final int INITIAL_CAPACITY = 16;
	// 实际存放的是一个Entry[]数组，长度必须是2的幂次方
    private Entry[] table;

    private int size = 0;
	// Entry数组扩容阈值
    private int threshold; // Default to 0

    // 阈值计算方法，为数组长度的三分之二
    private void setThreshold(int len) {
       threshold = len * 2 / 3;
    }

    // 默认的构造函数
    ThreadLocalMap(ThreadLocal<?> firstKey, Object firstValue) {
        table = new Entry[INITIAL_CAPACITY];
        int i = firstKey.threadLocalHashCode & (INITIAL_CAPACITY - 1);
        table[i] = new Entry(firstKey, firstValue);
        size = 1;
        setThreshold(INITIAL_CAPACITY);
    }
    // 这个构造函数是用来继承父线程中的ThreadLocalMap的
    private ThreadLocalMap(ThreadLocalMap parentMap) {
        Entry[] parentTable = parentMap.table;
        int len = parentTable.length;
        setThreshold(len);
        table = new Entry[len];

        for (int j = 0; j < len; j++) {
            Entry e = parentTable[j];
            if (e != null) {
                @SuppressWarnings("unchecked")
                ThreadLocal<Object> key = (ThreadLocal<Object>) e.get();
                if (key != null) {
                    Object value = key.childValue(e.value);
                    Entry c = new Entry(key, value);
                    int h = key.threadLocalHashCode & (len - 1);
                    while (table[h] != null)
                        h = nextIndex(h, len);
                    table[h] = c;
                    size++;
                }
            }
        }
    }
    ...省略部分代码
}
```

上面只列举了ThreadLocalMap的成员变量以及它的构造函数。ThreadLocalMap存储变量是通过一个静态内部类Entry来包装变量的，其中Entry的构造函数中将ThreadLocal作为key，变量作为value最终构造出一个新的Entry，然后将这个Entry添加到ThreadLocalMap中的Entry数组中。值得注意的是它的默认的构造函数

```java
ThreadLocalMap(ThreadLocal<?> firstKey, Object firstValue) {
    table = new Entry[INITIAL_CAPACITY];
    int i = firstKey.threadLocalHashCode & (INITIAL_CAPACITY - 1);
    table[i] = new Entry(firstKey, firstValue);
    size = 1;
    setThreshold(INITIAL_CAPACITY);
}
```

1. 这个Entry数组初始化长度是16
2. Entry数组扩容阈值为数组长度的三分之二，也就初始化扩容阈值为10
3. Entry存放的数组下表是通过特定的hash计算方式得出的，这里是通过ThreadLocal的threadLocalHashCode与数组的长度减一做&运算计算出来的


## ThreadLocal

我们现在知道每个Thread都拥有一个ThreadLocalMap成员变量，然后通过ThreadLocal的set方法将我们定义的变量设置到当前请求线程的ThreadLocalMap中，那么背后整个逻辑是什么呢？在分析之前我们需要先了解一下常见的几种解决hash冲突的算法，[资料来源](#资料来源)，强烈建议先去了解一下这些解决方法，这样对有助于更好的理解ThreadLocalMap背后实现的原理。这里直接给出结论，**ThreadLocalMap中是通过线性探测法解决hash冲突的。**

### set方法
```java
public void set(T value) {
    Thread t = Thread.currentThread();
    ThreadLocalMap map = getMap(t);
    if (map != null)
        map.set(this, value);
    else
        createMap(t, value);
}
```

1. 获取当前线程的ThreadLocalMap
2. 判断当前线程是否已经初始化ThreadLocalMap

先来看一下当前线程没有初始化ThreadLocalMap的逻辑

```java
void createMap(Thread t, T firstValue) {
	t.threadLocals = new ThreadLocalMap(this, firstValue);
}
```

如果当前线程没有初始化ThreadLocalMap的话，构造一个新的ThreadLocalMap赋值给Thread，这个构造函数的逻辑已经在上面分析过了，就不再累述了。接着我们看一下已经初始化ThreadLocalMap的逻辑

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
		// 执行到这说明两个ThreadLocal发生了hash冲突
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

如果当前线程已经初始化了ThreadLocalMap的话，则根据特定的hash算法计算出下一个Entry存放的数组下标。

1. 从哈希下标开始按步长 1 检查连续的非空槽，遇到同一键、过期条目或空槽时分别处理。

2. 将第一步中找出的Entry中的ThreadLocal与当前正在操作的ThreadLocal作比较，如果相等（指向同一个内存地址），则替换先前的旧值为现在的新值，立即结束循环。否则的话进入下面这个if判断

   ```java
   if (k == null) {
       replaceStaleEntry(key, value, i);
       return;
   }
   ```

   **注意如果即将执行这个if判断代表发生了hash冲突，说明有两个ThreadLocal对当前线程设值了，并且这两个ThreadLocal对象hash结果相同都指向这个槽位，并且如果zhegeif判断结果为true的话说明先前的ThreadLocal被gc回收了**，下面模拟一下hash冲突并且该槽位的ThreadLocal被gc回收的情况：

   ```java
   package io.allurx;

   import java.lang.reflect.Field;

   /**
    * @author allurx
    */
   public class DemoApplication {

       public static void main(String[] args) {
           new Worker().start();
       }

       static class Worker extends Thread {

           ThreadLocal<Integer> local1 = new ThreadLocal<>();

           void hashConflict() {
               ThreadLocal<Integer> local2 = new ThreadLocal<>();
               try {
                   Field field = ThreadLocal.class.getDeclaredField("threadLocalHashCode");
                   field.setAccessible(true);
                   field.set(local1, 0);
                   field.set(local2, 478700656);
                   local2.set(2);
               } catch (IllegalAccessException | NoSuchFieldException e) {
                   e.printStackTrace();
               }
           }

           @Override
           public void run() {
               hashConflict();
               System.gc();
               local1.set(1);
           }
       }
   }
   ```
在上面的例子中通过两个ThreadLocal给Worker线程设置值，这里通过反射重新设置了ThreadLocal的threadLocalHashCode来模拟hash冲突（这两个魔法数字会在下面讲解）

1. local2 失去其他强引用后可以被回收，但 System.gc 不保证本次就清除它。如果查找时遇到键已清除的 Entry，replaceStaleEntry 会清理并重新安排这一段探测链。

2. 如果 local2 尚未被清除，它与 local1 仍是两个不同的键，不能覆盖它的值。查找会沿探测链继续，直到找到同一键或可用的空槽，再执行下面的插入。

      ```java
      tab[i] = new Entry(key, value);
      ```
   最后再清除一些过期的Entry

      ```java
   if (!cleanSomeSlots(i, sz) && sz >= threshold)
          rehash();
      ```

如果启发式清理没有删除过期条目，并且当前有效条目计数 size 达到阈值，就调用 rehash。rehash 先清理全表，再根据剩余条目数量判断是否扩容，不是按数组长度与阈值比较。
对set方法的逻辑做一个总结，当调用ThreadLocal的set方法时：
1. 如果当前线程没有初始化ThreadLocalMap则构造一个新的ThreadLocalMap赋值给Thread的threadLocals变量，这个初始化的ThreadLocalMap是通过Entry数组来存储数据的，这个Entry是一个类似Map的数据结构，并且继承WeakReference持有ThreadLocal的弱引用，其中key为ThreadLocal，value为我们要设置给Thread的值。初始化大小为16。初始化扩容阈值为10
2. 如果当前线程已经初始化过ThreadLocalMap则获取当前线程的ThreadLocalMap，将ThreadLocal以及value设置到它的Entry数组中去，此时心Entry的在数组的下标是通过ThreadLocal的threadLocalHashCode与数组长度减一作&运算出来的。在放入对应数组下标前会先判断在这个数组下标中有没有Entry存在：
   1. 如果不存在的话，new一个新的Entry放进去。
   2. 如果存在的话，判断这个Entry中的ThreadLocal是不是和当前调用的ThreadLocal相同，如果相同则替换这个Entry中的value为新的value（相当于覆盖了前面一个值），如果不是同一个ThreadLocal说明这两个ThreadLocal发生了hash冲突，此时从发生冲突的当前下标往下直到找到一个过期的Entry（Entry不为null但是Entry引用的ThreadLocal为null），将ThreadLocal与value设置到这个Entry中，然后立即返回。
   3. 如果在第二步一直找不到过期的Entry，处理方式和第一步一样，new一个新的Entry放进去。
   4. 插入新条目后调用 cleanSomeSlots 做启发式清理；没有清理成果且条目计数 size 达到阈值时调用 rehash。

set方法的主要逻辑已经分析完了，还有一些细枝末节的地方没有分析到，主要包括replaceStaleEntry，expungeStaleEntry，cleanSomeSlots这几个方法，下面我们就来分下一下这几个方法背后的原理
#### expungeStaleEntry方法

```java
private int expungeStaleEntry(int staleSlot) {
    Entry[] tab = table;
    int len = tab.length;

    // expunge entry at staleSlot
    tab[staleSlot].value = null;
    tab[staleSlot] = null;
    size--;

    // Rehash until we encounter null
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

                // Unlike Knuth 6.4 Algorithm R, we must scan until
                // null because multiple entries could have been stale.
                while (tab[h] != null)
                    h = nextIndex(h, len);
                tab[h] = e;
            }
        }
    }
    return i;
}

```

1. 将给定过期槽位的Entry的value设置为null然后设置该槽位为null
2. 从该槽位开始往下直到找到一个空槽位为止，
   1. 如果该槽位上的Entry已经过期，将该Entry的value设置为null，将该Entry设置为null
   2. 活条目的理想槽位可能在已清空的位置之前，因此需要重新计算哈希并插入剩余探测链。否则 get 遇到新产生的空槽就会提前终止，错误地认为键不存在；重新定位首先保证查找正确性。
3. 返回过期Entry之后的第一个空槽位的索引

**expungeStaleEntry方法的作用就是将给定位置的过期槽位清除掉然后再扫描清除这个位置之后的一些同样过期的槽位以及尽可能的重新设置那些由于hash冲突而导致放置在不属于自己槽位的Entry。**

#### cleanSomeSlots方法

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

首选解释一下这个方法的两个参数的含义

* i：肯定不会持有过期Entry的槽位索引
* n：扫描控制，cleanSomeSlots方法在set方法中被调用时n值为当前Entry数组拥有的数量，在replaceStaleEntry方法中被调用时n值为当前Entry数组的长度

**cleanSomeSlots方法的作用是循环从给定的不会持有过期Entry的槽位索引的下一个索引开始，只要存在过期的Entry则将n的值重置为当前Entry数组的长度，调用expungeStaleEntry方法尝试清除从该索引位置之后的过期的Entry，直到n >>>=1（n=n / 2）为0为止。**

#### replaceStaleEntry方法

```java
private void replaceStaleEntry(ThreadLocal<?> key, Object value,
                               int staleSlot) {
    Entry[] tab = table;
    int len = tab.length;
    Entry e;

    int slotToExpunge = staleSlot;
    // 往前搜索过期的Entry，只要找到就将过期的Entry的索引赋值给slotToExpunge
    for (int i = prevIndex(staleSlot, len);
         (e = tab[i]) != null;
         i = prevIndex(i, len))
        if (e.get() == null)
            slotToExpunge = i;
    // 往后搜索过期的Entry
    for (int i = nextIndex(staleSlot, len);
         (e = tab[i]) != null;
         i = nextIndex(i, len)) {
        ThreadLocal<?> k = e.get();
        // 找到了ThreadLocal
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

replaceStaleEntry 先向前寻找这一段探测链中更早的过期条目，再向后寻找已有的同一键。如果找到了同一键，就更新 value，并将它与 staleSlot 交换；交换后的旧位置保存的是过期条目，随后从选定位置开始清理。若一直找到空槽也没有同一键，就用新 Entry 替换 staleSlot。清理过程同时重排后续活条目，以维持线性探测的可查找性。

### get方法

```java
public T get() {
    Thread t = Thread.currentThread();
    ThreadLocalMap map = getMap(t);
    if (map != null) {
        ThreadLocalMap.Entry e = map.getEntry(this);
        if (e != null) {
            @SuppressWarnings("unchecked")
            T result = (T)e.value;
            return result;
        }
    }
    return setInitialValue();
}
```

1. 如果当前线程已经初始化ThreadLocalMap则从ThreadLocalMap中获取ThreadLocal对应的value

2. 如果没有初始化ThreadLocalMap，调用setInitialValue方法初始化ThreadLocalMap以及返回初始化的值

当前线程已经初始化ThreadLocalMap

#### getEntry方法

```java
private Entry getEntry(ThreadLocal<?> key) {
    int i = key.threadLocalHashCode & (table.length - 1);
    Entry e = table[i];
    if (e != null && e.get() == key)
        return e;
    else
        return getEntryAfterMiss(key, i, e);
}
```

根据hash算法计算出ThreadLocal对应的槽位索引，只要该槽位中的Entry不为null并且引用的ThreadLocal和当前的ThreadLocal相同的话，则返回该Entry，否则的调用getEntryAfterMiss方法获取Entry（说明发生hash冲突了）

#### getEntryAfterMiss方法

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

1. 首先判断这个冲突槽位的Entry是否为null，如果为null直接就返回null
2. 向下扫描直到只要找到一个槽位的Entry引用的ThreadLocal是否和当前的ThreadLocal相同，就返回该Entry，并且中途如果发现某个Entry已经过期的话就调用expungeStaleEntry方法清除过期的Entry

当前线程没有初始化ThreadLocalMap

#### setInitialValue方法

```java
private T setInitialValue() {
    T value = initialValue();
    Thread t = Thread.currentThread();
    ThreadLocalMap map = getMap(t);
    if (map != null)
        map.set(this, value);
    else
        createMap(t, value);
    return value;
}
```

如果当前线程没有初始化ThreadLocalMap，首先调用initialValue方法

```java
protected T initialValue() {
	return null;
}
```

这个方法是用protected修饰的，也就是说我们在构造ThreadLocal的时候可以通过重写这个方法来给新线程初始化一个值。setInitialValue方法依旧会判断当前线程是否初始化ThreadLocalMap，然后选择调用set以及createMap方法，这两个方法的逻辑已经在上面分析过了，就不在累述了。

### remove方法

```java
 public void remove() {
     ThreadLocalMap m = getMap(Thread.currentThread());
     if (m != null)
         m.remove(this);
 }
```

从当前线程的ThreadLocalMap中移除该包含该ThreadLocal的Entry，最终调用ThreadLocalMap的remove方法

#### remove方法

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

1. 根据hash算法计算出ThreadLocal对应槽位的索引
2. 从该槽位向下扫描只要找到一个槽位中Entry引用的ThreadLocal和当前ThreadLocal相同，就清除该弱引用以及调用expungeStaleEntry方法清除过期槽位，然后返回。expungeStaleEntry方法已经在上面分析过了就不在累述了。

## 内存泄漏

ThreadLocalMap 的 Entry 弱引用键 ThreadLocal，却强引用 value。键失去其他强引用后可能被清除，value 仍可通过存活线程、ThreadLocalMap 和 Entry 保持可达。set、get、remove 只在相应路径上清理遇到的过期条目，不保证任意一次调用都清理全部内容。线程池复用使这种滞留更明显，应在业务绑定结束时通过 finally 调用 remove。

```java
private void exit() {
    if (group != null) {
        group.threadTerminated(this);
        group = null;
    }
    target = null;
    threadLocals = null;
    inheritableThreadLocals = null;
    inheritedAccessControlContext = null;
    blocker = null;
    uncaughtExceptionHandler = null;
}
```

线程退出时会清空 threadLocals 和 inheritableThreadLocals。若这些 Map 不再由其他对象持有，Map 与 Entry 就可以被回收；键或值本身是 static 并不会反向保住已经不可达的 Entry。静态引用可能独立保留键或值，其可达性需要单独判断。

## 魔术0x61c88647

每个ThreadLocal都拥有自己的hashcode从而能够能够将自己放入线程的ThreadLocalMap的hash槽位中。它的hashcode是通过以下方式生成的

```java
private final int threadLocalHashCode = nextHashCode();

private static AtomicInteger nextHashCode =
    new AtomicInteger();

private static final int HASH_INCREMENT = 0x61c88647;

private static int nextHashCode() {
    return nextHashCode.getAndAdd(HASH_INCREMENT);
}
```

每个 ThreadLocal 构造时通过 getAndAdd 将计数器增加固定步长 0x61c88647，再把获得的值保存为自己的哈希码；这是加上固定增量，不是每次翻倍。数组长度为 2 的幂时，以低位掩码计算起始槽位。

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
            int result = (HASH_INCREMENT * i) & n - 1;
            if (i != n - 1) {
                System.out.print(result + ",");
            } else {
                System.out.println(result);
            }
        }
    }

}
```

控制台输出

```java
0,1
0,3,2,1
0,7,6,5,4,3,2,1
0,7,14,21,28,3,10,17,24,31,6,13,20,27,2,9,16,23,30,5,12,19,26,1,8,15,22,29,4,11,18,25
```

可以发现只要输入的数是2的幂次方，那么这个算法就能均匀的将输出分布在这个数中。应用到ThreadLocal中就相当于如果多个ThreadLocal给当前的线程设置值，这种算法能够让ThreadLocal均匀的分布在ThreadLocalMap内的Entry数组中，最大限度的减少hash冲突。至于这个数字为什么这么神奇，从网上查阅到这个数字符合黄金分割比，有着浓厚的数学思想在里面，有兴趣的同学可以自行去研究一下。

## 总结

1. ThreadLocal的本质仅仅是一个工具类，他提供了一种能力可以用来给线程设置局部变量，在线程的生命周期内都可以访问这个变量，当然了它并不能保证这个变量是线程安全的，线程仅仅拥有这个变量的引用。
2. 每个线程都是通过它的成员变量ThreadLocalMap来保存这个变量的，而ThreadLocalMap又是通过一个Entry数组保存的
3. 使用ThreadLocal是有可能发生内存泄漏的，尤其是在使用线程池技术的时候，当不再使用这个变量的时候我们需要手动调用一下ThreadLocal的remove方法从当前线程的ThreadLocalMap中清除掉对ThreadLocal的引用

## 延伸阅读

[Hash算法解决冲突的方法](https://blog.csdn.net/feinik/article/details/54974293)
[散列表的基本原理与实现](https://www.cnblogs.com/absfree/p/5508570.html)
[java 解决Hash(散列)冲突的四种方法](https://blog.csdn.net/qq_27093465/article/details/52269862)

## 资料来源

- [ThreadLocal：按线程访问与 remove](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html)
- [WeakReference：弱可达性](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/WeakReference.html)
