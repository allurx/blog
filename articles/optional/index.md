---
title: 用 Optional 串起可能缺失的查询结果
date: 2019-06-24
updated: 2026-10-03
tags:
  - Java
  - Optional
domain: Java
---

按用户名查询手机号，要依次经过三个关口：名称是否有效、用户是否存在、手机号是否填写。每一步都可能让后续查询失去意义。`Optional` 可以把这条路径写成连续的转换，在末尾统一决定缺值时如何处理。

使用之前还要作一个业务判断：这三种失败是否真的可以合并？如果页面只需要显示“没有可用手机号”，合并很自然；如果接口必须分别报告参数错误和用户不存在，就应保留区别，不能为了缩短代码把信息丢掉。

本文先比较转换规则，再用查询手机号的完整程序贯穿成功与失败路径。示例仅依赖标准库，用法以 Java SE 25 为准，运行环境为 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）。

## 让查询中的每一步说明自己的返回结果

### 创建时确定 null 表示缺值还是违反约定

| 入口 | 传入 null 时 |
| --- | --- |
| Optional.of(value) | 抛 NullPointerException |
| Optional.ofNullable(value) | 得到空 Optional |
| Optional.empty() | 直接表达缺值 |

Optional 变量本身也不应为 null，否则调用链仍会在第一步失败。它主要适合可能不存在的返回结果，不应机械包住所有字段和参数。缺值与合法的空字符串、空集合也不是同一概念，应按业务语义区分。

### 转换结果决定使用 map 还是 flatMap

map 接收普通转换函数，再把结果包装；函数返回 null 时得到空 Optional。flatMap 接收已经返回 Optional 的函数，直接使用其结果；函数返回 null 则违反契约并抛异常。

| 转换 | 有值时 | 缺值时 |
| --- | --- | --- |
| filter(predicate) | 满足条件保留，否则缺值 | 保持缺值 |
| map(function) | 包装函数返回值，null 变缺值 | 不调用函数 |
| flatMap(function) | 使用函数返回的 Optional | 不调用函数 |
| ifPresent(consumer) | 执行动作 | 不执行动作 |

映射函数自己抛出的异常仍会传播。Optional 不会把数据库故障、解析错误等自动变为缺值；若两者有不同恢复策略，应分别表达。

## 查询例子：把缺值处理放在链的末尾

示例把两个接口分开：`findPerson()` 返回 `Optional<Person>`，因为用户可能不存在；`Person.phoneNumber()` 返回普通字符串，这份输入数据允许它为 `null`。因此前者接 `flatMap`，后者接 `map`。保存为 `PhoneLookupDemo.java`，执行 `javac -encoding UTF-8 -d out PhoneLookupDemo.java`、`java -cp out io.allurx.PhoneLookupDemo`。

```java
package io.allurx;

import java.util.Map;
import java.util.Optional;

/**
 * @author allurx
 */
public class PhoneLookupDemo {
    private static final Map<String, Person> PEOPLE = Map.of(
            "Alex", new Person("123456789"),
            "Sam", new Person(null));

    private record Person(String phoneNumber) {}

    private static Optional<Person> findPerson(String name) {
        return Optional.ofNullable(PEOPLE.get(name));
    }

    private static String requirePhoneNumber(String name) {
        return Optional.ofNullable(name)
                .filter(n -> !n.trim().isEmpty())
                .flatMap(PhoneLookupDemo::findPerson)
                .map(Person::phoneNumber)
                .orElseThrow(() -> new IllegalStateException("没有可用的手机号"));
    }

    public static void main(String[] args) {
        for (String name : new String[]{"Alex", "Missing", "Sam", " "}) {
            try {
                System.out.println("[" + name + "]: " + requirePhoneNumber(name));
            } catch (IllegalStateException exception) {
                System.out.println("[" + name + "]: " + exception.getMessage());
            }
        }
    }
}
```

输入 `Alex` 时，名称通过过滤，`flatMap` 取得用户，`map` 取得手机号。其他三条路径在不同位置变为空：`Missing` 在查用户时缺值，`Sam` 在读手机号时缺值，空白名称则在过滤阶段就停止。程序统一在链末尾处理它们：

```text
[Alex]: 123456789
[Missing]: 没有可用的手机号
[Sam]: 没有可用的手机号
[ ]: 没有可用的手机号
```

filter 只验证名称去掉首尾空白后非空，不会改变真正用于查询的字符串。如果业务希望忽略名字前后空白，应额外明确规范化规则，而不是误以为调用 trim 的谓词已经修改了输入。

## 在消费结果时决定默认值与失败方式

### 默认值是否延迟计算，会改变行为

orElse 的实参在调用前求值，即使有结果，构造默认值的函数也已经执行。orElseGet 的 Supplier 只在缺值时调用；orElseThrow 的异常提供者也只在缺值时调用。

```java
Optional.of("found").orElse(expensiveDefault());
Optional.of("found").orElseGet(() -> expensiveDefault());
```

这两行是行为对照片段，expensiveDefault 由业务提供：第一行调用它，第二行不会。选择不仅影响成本；如果函数有副作用或可能抛异常，两者的可观察行为也不同。

### 明确选择缺值时的分支

`get` 在缺值时抛 `NoSuchElementException`。对于手机号查询，如果缺值是正常情况，可以保留 `Optional<String>` 让调用方决定显示占位文字或隐藏联系按钮；如果当前操作必须有手机号，则在这里抛出能解释业务原因的异常。决定放在哪一层处理，比把每次 `get` 换成某个更长的方法名更有意义。

## 资料来源

- [Optional：转换、默认值与适用范围](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html)
