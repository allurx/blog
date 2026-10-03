---
title: Optional
date: 2019-06-24
updated: 2026-10-03
tags:
  - Java
  - Optional
domain: Java
---

Optional 表达一个结果可能不存在。它的价值在于让缺值分支出现在 API 和调用链里，而不是消灭所有 null 或捕获所有异常。选择 map、flatMap 和默认值操作时，要看函数返回什么，以及缺值时需要做什么。

本文先比较转换规则，再用查询手机号的完整程序贯穿成功与失败路径。示例仅依赖标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。内部背景参考 [OpenJDK 8u202-b08 Optional](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/Optional.java)，公开用法按 Java SE 25。

## 创建时就确定 null 的含义

| 入口 | 传入 null 时 |
| --- | --- |
| Optional.of(value) | 抛 NullPointerException |
| Optional.ofNullable(value) | 得到空 Optional |
| Optional.empty() | 直接表达缺值 |

Optional 变量本身也不应为 null，否则调用链仍会在第一步失败。它主要适合可能不存在的返回结果，不应机械包住所有字段和参数。缺值与合法的空字符串、空集合也不是同一概念，应按业务语义区分。

## map 与 flatMap 的区别在返回类型

map 接收普通转换函数，再把结果包装；函数返回 null 时得到空 Optional。flatMap 接收已经返回 Optional 的函数，直接使用其结果；函数返回 null 则违反契约并抛异常。

| 转换 | 有值时 | 缺值时 |
| --- | --- | --- |
| filter(predicate) | 满足条件保留，否则缺值 | 保持缺值 |
| map(function) | 包装函数返回值，null 变缺值 | 不调用函数 |
| flatMap(function) | 使用函数返回的 Optional | 不调用函数 |
| ifPresent(consumer) | 执行动作 | 不执行动作 |

映射函数自己抛出的异常仍会传播。Optional 不会把数据库故障、解析错误等自动变为缺值；若两者有不同恢复策略，应分别表达。

## 查询例子：把缺值处理放在链的末尾

保存为 Person.java，执行 `javac -encoding UTF-8 -d out Person.java`、`java -cp out io.allurx.Person`。

```java
package io.allurx;

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

    public static void main(String[] args) {
        Person person = new Person();
        person.phoneNumber = "123456789";
        map.put("Alex", person);
        System.out.println(getPerson("Alex"));
        try {
            getPerson("Missing");
        } catch (PersonException exception) {
            System.out.println(exception.getMessage());
        }
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

本次输出先是 123456789，再是“用户名无效、用户不存在或手机号为空”。这三种缺值在本例中合并成同一种业务失败；需要区分原因时，就不能在链中提前丢掉区别。

filter 只验证名称去掉首尾空白后非空，不会改变真正用于查询的字符串。如果业务希望忽略名字前后空白，应额外明确规范化规则，而不是误以为调用 trim 的谓词已经修改了输入。

## 默认值是否懒求值，会改变行为

orElse 的实参在调用前求值，即使有结果，构造默认值的函数也已经执行。orElseGet 的 Supplier 只在缺值时调用；orElseThrow 的异常提供者也只在缺值时调用。

```java
Optional.of("found").orElse(expensiveDefault());
Optional.of("found").orElseGet(() -> expensiveDefault());
```

这两行是行为对照片段，expensiveDefault 由业务提供：第一行调用它，第二行不会。选择不仅影响成本；如果函数有副作用或可能抛异常，两者的可观察行为也不同。

get 在缺值时抛 NoSuchElementException。已知必须有值时可按契约读取；否则优先在消费点明确默认值、错误或分支，不要先调用 get 再依靠异常判断是否缺值。

## 资料来源

- [Optional：转换、默认值与适用范围](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html)
- [OpenJDK 8u202-b08 Optional 的完整实现](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/util/Optional.java)
