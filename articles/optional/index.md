---
title: Optional
date: 2019-06-24
updated: 2026-10-02
tags:
  - Java
  - Optional
domain: Java
---

`Optional` 表达一个结果可能不存在，`map` 用于转换值，`flatMap` 用于衔接已经返回 `Optional` 的操作。它不会自动消除所有空指针：`Optional.of(null)`、返回 `null` 的 `flatMap` 函数以及映射函数内部的异常仍会失败。缺值时的默认行为或异常应在链的末尾明确处理。

下面以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/Optional.java) 的 Optional 实现说明转换与缺值处理。Optional 主要适合表达可能不存在的返回结果，不应代替所有空值判断，也不应把 Optional 变量本身设为 null。


## 原理

Optional 用容器表示有值或缺值。map、flatMap、filter 和 ifPresent 只在有值时执行相应函数；orElseGet 和 orElseThrow 的提供者则只在缺值时调用。orElse 的实参会在调用前求值，即使 Optional 有值也可能执行代价较高的默认值计算。

## Optional源码

```java
package java.util;

import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

public final class Optional<T> {

    // value为空的Optional对象
    private static final Optional<?> EMPTY = new Optional<>();

    // 包含的value对象
    private final T value;

    private Optional() {
        this.value = null;
    }

    // 返回一个空的Optional对象
    public static<T> Optional<T> empty() {
        @SuppressWarnings("unchecked")
        Optional<T> t = (Optional<T>) EMPTY;
        return t;
    }

    // 构造一个不为空的Optional对象，如果value为null，则抛出NullPointerException
    private Optional(T value) {
        this.value = Objects.requireNonNull(value);
    }

    // 生成一个不为空的Optional对象，注意这个value不能为null，否则会抛出NullPointerException
    public static <T> Optional<T> of(T value) {
        return new Optional<>(value);
    }

    // 如果value为null则生成一个空的Optional对象，否则生成一个不为空的Optional对象
    public static <T> Optional<T> ofNullable(T value) {
        return value == null ? empty() : of(value);
    }

    // 获取Optional包含的对象，如果value为null则抛出NoSuchElementException
    public T get() {
        if (value == null) {
            throw new NoSuchElementException("No value present");
        }
        return value;
    }

    // 判断Optional包含的对象是否为null
    public boolean isPresent() {
        return value != null;
    }

    // Optional包含的对象不为null时执行Consumer
    public void ifPresent(Consumer<? super T> consumer) {
        if (value != null)
            consumer.accept(value);
    }

    // 1、Optional包含的对象为null时，返回自身
    // 2、Optional包含的对象不为null时并且Predicate执行结果为true，返回自身，否则返回空的Optional
    public Optional<T> filter(Predicate<? super T> predicate) {
        Objects.requireNonNull(predicate);
        if (!isPresent())
            return this;
        else
            return predicate.test(value) ? this : empty();
    }

    // 1、Optional包含的对象为null时，返回空的Optional
    // 2、Optional包含的对象不为null时，返回一个新的Optional，它包含的对象是Function执行返回的结果
    public<U> Optional<U> map(Function<? super T, ? extends U> mapper) {
        Objects.requireNonNull(mapper);
        if (!isPresent())
            return empty();
        else {
            return Optional.ofNullable(mapper.apply(value));
        }
    }

    // 1、Optional包含的对象为null时，返回空的Optional
    // 2、Optional包含的对象不为null时，返回一个新的Optional，主意这个Optional是Function返回的
    public<U> Optional<U> flatMap(Function<? super T, Optional<U>> mapper) {
        Objects.requireNonNull(mapper);
        if (!isPresent())
            return empty();
        else {
            return Objects.requireNonNull(mapper.apply(value));
        }
    }

    // 如果Optional包含的对象不为null则返回该对象，否则返回指定的其它对象
    public T orElse(T other) {
        return value != null ? value : other;
    }

    // 如果Optional包含的对象不为null则返回该对象，否则返回Supplier执行返回的结果
    public T orElseGet(Supplier<? extends T> other) {
        return value != null ? value : other.get();
    }

    // 如果Optional包含的对象不为null则返回该对象，否则抛出Supplier执行返回的异常
    public <X extends Throwable> T orElseThrow(Supplier<? extends X> exceptionSupplier) throws X {
        if (value != null) {
            return value;
        } else {
            throw exceptionSupplier.get();
        }
    }

    // 重写了equals方法
    // 1、同一个对象返回true
    // 2、不是Optional实例返回false
    // 3、比较这两个Optional包含的对象
    @Override
    public boolean equals(Object obj) {
        if (this == obj) {
            return true;
        }

        if (!(obj instanceof Optional)) {
            return false;
        }

        Optional<?> other = (Optional<?>) obj;
        return Objects.equals(value, other.value);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(value);
    }

    @Override
    public String toString() {
        return value != null
            ? String.format("Optional[%s]", value)
            : "Optional.empty";
    }
}
```

Optional 的方法按有值和缺值分支组织逻辑，不能笼统地说所有函数只在有值时执行。它让缺值路径更清楚，但不会捕获映射函数抛出的异常。下面比较 map 和 flatMap。

```java
public<U> Optional<U> map(Function<? super T, ? extends U> mapper) {
    Objects.requireNonNull(mapper);
    if (!isPresent())
        return empty();
    else {
        return Optional.ofNullable(mapper.apply(value));
    }
}

public<U> Optional<U> flatMap(Function<? super T, Optional<U>> mapper) {
    Objects.requireNonNull(mapper);
    if (!isPresent())
        return empty();
    else {
        return Objects.requireNonNull(mapper.apply(value));
    }
}
```

咋一看这两个方法长的很像，返回值和入参都差不多，其实它们是两种不同的设计，先来说第一个map方法，它的入参返回类型是U类型的。最后return又重新对这个U类型的结果进行包装了一次，所以最终方法返回类型是Optional。再来看一下flatMap方法，它的入参返回类型是`Optional<U>`类型的，最终的方法返回值就是Function执行返回的结果，也就是Optional，所以从本质上来讲这个两个方法返回的结果是一样的，都返回了Optional对象，区别在于如果我们调用了map方法，不需要手动创建一个新的Optional，但是如果调用了flatMap方法，我我们就需要手动返回一个Optional对象了

## 例子

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * @author allurx
 */
public class Person {

    private String phoneNumber;

    private static Map<String, Person> map = new HashMap<>();

    public static String getPerson(String name) {
        return Optional.ofNullable(name)
                .filter(n -> !n.trim().isEmpty())
                .map(n -> map.get(n))
                .flatMap(person -> Optional.ofNullable(person.getPhoneNumber()))
                .orElseThrow(() -> new PersonException("用户名无效、用户不存在或手机号为空"))
                ;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public static class PersonException extends RuntimeException {

        PersonException(String message) {
            super(message);
        }

    }

}

```

根据用户名查询用户信息

1. Optional.ofNullable(name)	`Optional<String>`
   * 初始化一个可能包含空对象的Optional
2. `filter(n -> !n.trim().isEmpty())`    `Optional<String>`
   * 如果name本身就是null的话，返回Optional本身
   * 如果 name 不为空且去掉首尾空白后仍有内容，继续查询；否则得到空的 Optional
3. `map(n -> map.get(n))`   `Optional<Person>`
   * 根据用户名获取用户
4. `flatMap(person -> Optional.ofNullable(person.getPhoneNumber()))`    `Optional<String>`
   * 把可能为空的手机号转为 Optional，空手机号会进入最后的缺值处理
5. `orElseThrow(() -> new PersonException("用户名无效、用户不存在或手机号为空"))`
   * 用户名无效、用户不存在或手机号为空时，按需创建并抛出自定义异常

## 总结

1. Optional可以看做是一个容器，内部维护一个对象指向将要被处理的可能为null的值
2. Optional 让缺值路径显式化，但映射函数的内部错误与不合法的 null 返回值仍需要按契约处理

## 资料来源

- [Optional：map、flatMap 与缺值处理](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html)
