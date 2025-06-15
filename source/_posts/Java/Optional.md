---
title: Optional
date: 2019-06-24
categories:
- Java
- Optional
tags:
- Java
- Optional
---

# 概述

相信每个java程序员都曾经在编码的过程中遇到过NullPointerException，毕竟在程序运行期间，谁也不能百分百保证当前正在调用的对象一定不为null。本文要介绍的是java 1.8新加入的一个类`Optional`，使用它我们就可以在代码中优雅的处理null，避免了大量`if (o == null)`这种操作，同时最大限度避免程序在运行时抛出`NullPointerException`

<!-- more -->

# 原理

Optional处理null的原理很简单，我们可以把Optional当做是一个容器，它仅仅包含了某个将要被处理的对象，当然了这个对象可能是null也可能不是null，例如当我们调用：`Optional.ofNullable(value)`方法后，一个Optional实例就被创建完成了，接下来我们就不用关心这value是不是null，只需要调用Optional提供的方法，传入一些`FunctionalInterface`，**只有当value不为null时**，这些`FunctionalInterface`才会被执行。接下来我们看一下它的源码

# Optional源码

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

Optional的源码很简单，内部方法执行的逻辑都是基于Optional包含的对象不为null的情况下才会执行，极大的减少了程序运行期间抛出的NullPointerException同时也使得我们编码的方式变得更加的优雅。里面有两个比较相似的方法

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

# 例子

```java
import org.apache.commons.lang3.StringUtils;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * @author zyc
 */
public class Person {

    private String phoneNumber;

    private static Map<String, Person> map = new HashMap<>();

    public static String getPerson(String name) {
        return Optional.ofNullable(name)
                .filter(StringUtils::isNotBlank)
                .map(n -> map.get(n))
                .flatMap(person -> Optional.of(person.getPhoneNumber()))
                .orElseThrow(new PersonException("该用户手机号为空"))
                ;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public static class PersonException extends RuntimeException implements Supplier<PersonException> {

        PersonException(String message) {
            super(message);
        }

        @Override
        public PersonException get() {
            return this;
        }
    }

}

```

根据用户名查询用户信息

1. Optional.ofNullable(name)	`Optional<String>`
   * 初始化一个可能包含空对象的Optional
2. `filter(StringUtils::isNotBlank)`    `Optional<String>`
   * 如果name本身就是null的话，返回Optional本身
   * 如果name不为null，并且Predicate执行返回true，返回本身，否则返回一个空的Optional
3. `map(n -> map.get(n))`   `Optional<Person>`
   * 格局用户名获取用户
4. `flatMap(person -> Optional.of(person.getPhoneNumber()))`    `Optional<String>`
   * 获取用户的手机号码，注意这里手动创建了一个新的Optional对象
5. `orElseThrow(new PersonException("该用户手机号为空"))`
   * 如果手机号码为null的话就抛出自定义的异常

# 总结

1. Optional可以看做是一个容器，内部维护一个对象指向将要被处理的可能为null的值
2. Optional在执行各个方法前会先判断内部维护的这个对象是否为null，最大限度的避免NullPointerException的出现