---
title: InheritableThreadLocal 继承的是哪个时刻的值
date: 2019-07-22
updated: 2026-10-03
tags:
  - Java
  - Thread
  - InheritableThreadLocal
domain: Java
---

父线程把请求 ID 设为 `A`，创建一个 Thread 对象，然后把请求 ID 改为 `B`，最后才启动子线程。子线程继承的是哪个值？对允许继承线程局部值的普通平台线程，答案是创建 Thread 时的 `A`。

这个时刻决定了 InheritableThreadLocal 的用途：它适合为新线程提供初始上下文。若要在每次提交线程池任务时传递请求 ID，就必须另外安排任务级的传播，因为复用线程不会重新执行一次继承。

本文先比较绑定复制和对象复制，再分析 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/InheritableThreadLocal.java) 中的线程构造路径。示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。示例使用普通平台线程，当前 Thread API 还允许通过构造或构建选项控制是否继承线程局部值。

## 从父线程绑定到子线程初始值

### 构造 Thread 时复制，start 时不再复制

父线程对普通 ThreadLocal 的绑定存于 threadLocals，对 InheritableThreadLocal 的绑定存于 inheritableThreadLocals。Java 8 的 Thread.init 在允许继承且父 Map 非空时，调用 ThreadLocal.createInheritedMap 创建子线程自己的 Map。

复制发生在创建 Thread 对象的阶段，不是 start 时刻。若创建对象后父线程再 set 新值，不能据此期待已创建子线程自动更新；线程池复用已有 Worker 时，也不会因为一次新提交而再次构造该 Worker。

### 新 Map 不等于新对象

子线程 Map 是新 Map，但默认 `childValue(parentValue)` 原样返回参数。若父值是一个可变 List，父子两份绑定就指向同一个 List；修改其中元素会作用于同一对象。若父线程执行 `set(另一个 List)`，改变的则只是自己的绑定，子线程仍持有原来的引用。

需要不同初始值时，可以重写 `childValue`。下面用不可变的 Integer 和 String 展示默认继承与定制继承：

```java
package io.allurx;

/**
 * @author allurx
 */
public class DemoApplication {

    private static InheritableThreadLocal<Integer> inheritableThreadLocal1 = new InheritableThreadLocal<>();
    private static InheritableThreadLocal<String> inheritableThreadLocal2 = new InheritableThreadLocal<String>() {

        @Override
        public String childValue(String parentValue) {
            return parentValue.concat("1");
        }
    };

    public static void main(String[] args) {
        inheritableThreadLocal1.set(1);
        inheritableThreadLocal2.set("1");
        print();
        new Thread(DemoApplication::print).start();
    }

    static void print() {
        System.out.println(Thread.currentThread().getName() + ":" + inheritableThreadLocal1.get());
        System.out.println(Thread.currentThread().getName() + ":" + inheritableThreadLocal2.get());
    }

}
```

保存为 DemoApplication.java，执行 `javac -encoding UTF-8 -d out DemoApplication.java`、`java -cp out io.allurx.DemoApplication`。该示例的输出为：

```text
main:1
main:1
Thread-0:1
Thread-0:11
```

Integer 使用默认继承；String 的 childValue 把父值拼接为新字符串。childValue 在父线程创建子线程时调用，子线程稍后读取的是已经初始化的结果。

## Map 复制时为什么跳过过期键

父 Map 中 Entry 的键是弱引用，可能已经被 GC 清除。复制循环只处理仍有键的条目，调用键的 childValue，并按该键的哈希码把新 Entry 放进子 Map。

```java
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
```

同一 ThreadLocalMap 结构的存储、线性探测与清理见 [ThreadLocal](/thread-local/)。InheritableThreadLocal 重写 getMap、createMap，使标准 get/set/remove 操作到继承 Map；并不是再维护一套跨线程同步容器。

## 在线程池中显式传递任务上下文

假设 Worker 因请求 A 第一次提交任务而创建，它可能继承 A 的请求 ID。请求 B 后来使用同一个 Worker，线程构造过程不会再运行，B 也就不会自动替换那份绑定。如果 Worker 在任何请求到来前就已启动，它甚至可能没有请求 ID。

所以，传播请求上下文应围绕一次任务完成：提交时捕获，执行前安装，执行后清理或恢复。只传几个参数时，直接把它们作为任务参数更容易看清数据来自哪里。

同样要考虑对象是否可变、嵌套任务是否需要恢复外层绑定。InheritableThreadLocal 只规定初始化行为，不替应用决定请求身份、数据生命周期或取消后的清理政策。

## 资料来源

- [InheritableThreadLocal：childValue 与继承时机](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InheritableThreadLocal.html)
- [Java 8 ThreadLocal：继承 Map 的复制实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/ThreadLocal.java)
- [Thread：继承线程局部值的控制](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
