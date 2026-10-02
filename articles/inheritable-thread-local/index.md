---
title: InheritableThreadLocal
date: 2019-07-22
updated: 2026-10-02
tags:
  - Java
  - Thread
  - InheritableThreadLocal
domain: Java
---

`InheritableThreadLocal` 在创建子线程时初始化继承值，默认 `childValue()` 返回父线程的同一对象引用。它不是持续同步，也不是按任务传播上下文：线程池复用已经存在的工作线程时，不会随每次提交重新复制提交者的值。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/InheritableThreadLocal.java) 分析线程构造时如何复制继承值。默认只复制绑定关系，childValue 返回同一对象；需要隔离可变对象时应定义复制规则。线程池任务需要提交时的上下文时，应显式传递并按任务边界清理。


## 线程初始化

在分析InheritableThreadLocal的实现原理之前，我们需要先了解一下Thread的源码，因为这个InheritableThreadLocal的实现和ThreadLocal一样是与线程紧密相关的。通过查看Thread的源码得知原来Thread同样还拥有一个名称为inheritableThreadLocals的ThreadLocalMap类型的成员变量。接着我们看一下Thread的init方法（所有线程的构造函数最终都会调用这个方法）

```java
private void init(ThreadGroup g, Runnable target, String name,
                  long stackSize, AccessControlContext acc,
                  boolean inheritThreadLocals) {
	...省略部分代码
    Thread parent = currentThread();
    if (inheritThreadLocals && parent.inheritableThreadLocals != null)
        this.inheritableThreadLocals =
            ThreadLocal.createInheritedMap(parent.inheritableThreadLocals);
   ...省略部分代码
}

```

我们发现在线程初始化时，只要执行线程的inheritableThreadLocals不为null的话（Thread的所有public构造函数在调用这个init方法时传递的`boolean inheritThreadLocals`都是true）就会调用ThreadLocal的静态方法createInheritedMap。这个createInheritedMap方法的作用就是构造一个新的ThreadLocalMap然后将父线程ThreadLocalMap中的Entry数组拷贝到子线程的ThreadLocalMap中。下面我们接着分析一下这个createInheritedMap方法

### createInheritedMap方法

```java
static ThreadLocalMap createInheritedMap(ThreadLocalMap parentMap) {
	return new ThreadLocalMap(parentMap);
}
```

new了一个新的ThreadLocalMap对象，入参是父线程的ThreadLocalMap（inheritableThreadLocals），看一下这个构造函数

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

实现很简单，只取父线程ThreadLocalMap的Entry数组中Entry不为null并且引用的ThreadLocal不为null的Entry，然后通过hash算法计算出下标放到新的Entry数组中。在复制value时调用了一个childValue方法，这个方法在ThreadLocal中的定义如下

```java
T childValue(T parentValue) {
	throw new UnsupportedOperationException();
}
```

这里直接抛出了异常，因为在调用createInheritedMap方法的时候确定创建的是InheritableThreadLocal，所以此时的调用者为InheritableThreadLocal，它重写了这个方法，目的是为了提供修改父线程中的value的能力，比如说父线程中的value为1，此时创建子线程时可能需要在这个value的基础上变更为100，那么这个childValue方法就有意义了。下面我们看一下InheritableThreadLocal的源码

## InheritableThreadLocal

```java
public class InheritableThreadLocal<T> extends ThreadLocal<T> {

    protected T childValue(T parentValue) {
        return parentValue;
    }

    ThreadLocalMap getMap(Thread t) {
       return t.inheritableThreadLocals;
    }

    void createMap(Thread t, T firstValue) {
        t.inheritableThreadLocals = new ThreadLocalMap(this, firstValue);
    }
}
```

源码很简单，重写了父类ThreadLocal的是三个方法，重写childValue的意义在于复制父线程value时能够自定义的修改这个value。重写getMap和createMap的意义在于调用ThreadLocal的set，get，remove方法时取到的或者创建的是Thread的inheritableThreadLocals变量，而不是threadLocals变量。

## 例子

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

控制台输出

```
main:1
main:1
Thread-0:1
Thread-0:11
```

## 总结

InheritableThreadLocal的运行原理和ThreadLocal一致，只不过它相对于ThreadLocal多出了一项功能，当在执行线程中创建子线程时，如果执行线程的inheritableThreadLocals不为null的话（也就是通过InheritableThreadLocal给执行线程设置了值），那么子线程就会将这个inheritableThreadLocals拷贝到自己的成员变量inheritableThreadLocals中。

## 资料来源

- [InheritableThreadLocal：初始化时机与 childValue](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InheritableThreadLocal.html)
- [Thread：继承线程局部值的控制](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
