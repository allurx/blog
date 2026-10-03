---
title: AnnotatedType
date: 2019-11-05
updated: 2026-10-03
tags:
  - Java
  - Reflect
  - AnnotatedType
domain: Java
---

假设一个脱敏框架需要处理 `List<@Sensitive String> names`。标记落在列表中的字符串上，含义可以是“逐个处理列表元素”；如果写成 `@Sensitive List<String> names`，标记的位置已经变了。只调用 `Field.getAnnotations()`，无法完整回答注解究竟放在哪里。

`AnnotatedType` 提供了带注解的类型视图。它保留参数化类型、类型变量、通配符和数组的结构，让程序沿着类型逐层读取对应位置的注解。理解它的关键，是把类型看成有父子关系的结构，逐个位置读取，而不是一次收集成没有位置的注解列表。

本文按 Java SE 25 的公开 API 说明。需要先了解 [Type 的结构](/reflection-types/)和[注解查询范围](/annotated-element/)。完整示例只用标准库，目标环境是 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）。

## 先找到类型视图的入口

声明对象与它使用的类型是两个入口。例如，`Field` 描述一个字段声明，`Field.getAnnotatedType()` 描述这个字段使用的类型；两个对象都能查询注解，但查询位置不同。

| 声明入口 | 普通类型视图 | 带注解的类型视图 |
| --- | --- | --- |
| 字段 | `getGenericType()` | `getAnnotatedType()` |
| 方法返回值 | `getGenericReturnType()` | `getAnnotatedReturnType()` |
| 方法参数 | `getGenericParameterTypes()` | `getAnnotatedParameterTypes()` |
| 父类声明 | `getGenericSuperclass()` | `getAnnotatedSuperclass()` |

类型使用注解需要允许 `TYPE_USE`，运行时读取还需要 `RUNTIME` 保留策略。本文用下面的注解给每个位置编号；编号只帮助追踪位置，不实现任何脱敏或校验功能。

```java
@Target(ElementType.TYPE_USE)
@Retention(RetentionPolicy.RUNTIME)
public @interface Mark {
    int value();
}
```

取得一个 `AnnotatedType` 后，`getAnnotations()` 读取当前节点的注解，`getType()` 取得对应的普通 `Type`。后者仍保留泛型结构，但不携带当前视图上的类型使用注解。

## 沿泛型结构读取注解

下面的字段片段都来自[完整示例 AnnotatedTypeDemo.java](./AnnotatedTypeDemo.java)。每次先看标记写在哪个类型位置，再选择对应的反射接口。

### 参数化类型：先到实参，再继续向内

```java
List<@Mark(1) String> names;
List<@Mark(2) List<@Mark(3) String>> groups;
```

`names` 的外层是一个 `AnnotatedParameterizedType`。调用 `getAnnotatedActualTypeArguments()[0]`，才来到带 `@Mark(1)` 的 `String`；直接读取外层列表的注解不会得到它。

`groups` 多了一层：外层列表的第一个实参是带 `@Mark(2)` 的 `List<String>`。这个实参仍然是参数化类型，再读取一次它的实参，才得到 `String` 上的 `@Mark(3)`。遍历时需要根据当前节点的类型继续展开，不能假定第一个实参一定是普通类。

```text
groups：List
└─ 实参 0：List，Mark=2
   └─ 实参 0：String，Mark=3
```

这也是开篇脱敏问题需要保留的结构：标记列表本身与标记列表中的字符串，业务可能采取完全不同的处理方式。

### 类型变量：使用位置与上界分开读取

```java
class AnnotatedTypeDemo<
        T extends @Mark(4) Number & @Mark(5) Serializable> {
    @Mark(6) T value;
}
```

`value` 的类型视图是 `AnnotatedTypeVariable`，当前节点上的标记是 `6`。调用它的 `getAnnotatedBounds()` 后，才会得到 `Number` 上的 `4` 与 `Serializable` 上的 `5`。

`T` 上的标记和 `T` 的上界承担不同含义。比如，一个标记约束这个字段怎样使用 `T`，另一个标记描述声明时允许的边界，它们没有自动合并的规则。未显式声明上界时，API 仍返回无注解的 `Object` 上界。

### 通配符：上界和下界各有入口

```java
List<? extends @Mark(7) Number> producers;
List<? super @Mark(8) Number> consumers;
```

先通过外层 `AnnotatedParameterizedType` 取得实参，再将这个实参作为 `AnnotatedWildcardType` 处理。`getAnnotatedUpperBounds()` 读取上界，`getAnnotatedLowerBounds()` 读取下界。

`producers` 的上界 `Number` 携带 `7`，没有下界。`consumers` 的下界 `Number` 携带 `8`，同时还有一个无注解的 `Object` 上界。因此，读取下界通配符时看到一个没有注解的上界，并不代表反射丢掉了 `8`，而是还没走到下界位置。

## 数组的每一层都有自己的注解位置

数组容易读错，是因为方括号与元素类型都能带注解：

```java
@Mark(9) String @Mark(10) [] @Mark(11) [] matrix;
```

从字段类型开始读，最外层数组带 `10`。第一次调用 `getAnnotatedGenericComponentType()`，得到的组件还是数组，带 `11`；第二次调用才到元素类型 `String`，带 `9`。

```text
matrix：二维数组，Mark=10
└─ 组件：一维数组，Mark=11
   └─ 组件：String，Mark=9
```

因此，数组遍历应当先读取当前节点，再进入组件。不要把同一个组件既作为父节点的附加信息打印一次，又在递归中打印一次，否则会把同一条注解重复计入结果。

组件也可能是参数化类型，例如 `List<@Mark(1) String>[]`，或类型变量，例如 `T[]`。进入组件之后仍按当前接口分派，数组和泛型便能使用同一套遍历思路。

## 运行一个保留位置的遍历程序

下载 [AnnotatedTypeDemo.java](./AnnotatedTypeDemo.java)，在文件所在目录运行：

```shell
javac -encoding UTF-8 -d out AnnotatedTypeDemo.java
java -cp out io.allurx.AnnotatedTypeDemo
```

程序按指定字段名读取，不依赖 `getDeclaredFields()` 的枚举顺序。每一行输出一条类型路径及该位置的标记；核心递归先打印当前节点，再分别进入实参、边界或数组组件。下面是完整输出，`-` 表示该位置没有 `Mark`：

```text
names: -
names.argument[0]: 1
groups: -
groups.argument[0]: 2
groups.argument[0].argument[0]: 3
value: 6
value.bound[0]: 4
value.bound[1]: 5
producers: -
producers.argument[0]: -
producers.argument[0].upper[0]: 7
consumers: -
consumers.argument[0]: -
consumers.argument[0].upper[0]: -
consumers.argument[0].lower[0]: 8
matrix: 10
matrix.component: 11
matrix.component.component: 9
```

这个输出故意保留没有注解的中间节点。若只列出 `2` 和 `3`，就看不出它们分别属于内层列表和字符串；有路径后，读取结果才能重新对应到声明。

## 结构读出来以后，业务还要决定什么

`AnnotatedType` 提供声明信息，不会自动执行注解对应的行为。脱敏框架需要决定标记容器与标记元素各自如何处理；校验框架需要决定变量实际类型的替换与规则组合。这些语义需要由使用注解的框架定义。

通用遍历还要处理示例没有覆盖的结构。例如 `T extends Comparable<T>` 会在上界中再次遇到 `T`，不能无限递归；成员类型的拥有者可通过 `getAnnotatedOwnerType()` 查询。完整示例专门演示这里列出的无环字段，不是一份可直接替代通用类型解析器的实现。

如果只需要读取普通类类型上的注解，直接使用 `AnnotatedType` 的公共方法即可，无需依赖 JDK 内部实现类。作者的 [Blur 数据脱敏库](https://github.com/allurx/blur/blob/main/README.zh-CN.md)是把类型位置用于业务规则的一个例子，运行本文示例不需要引入该库。

## 资料来源

- [AnnotatedType：类型使用与拥有者](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedType.html)
- [AnnotatedParameterizedType：带注解的实参](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedParameterizedType.html)
- [AnnotatedTypeVariable：带注解的边界](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedTypeVariable.html)
- [AnnotatedWildcardType：上下界](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedWildcardType.html)
- [AnnotatedArrayType：数组组件](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedArrayType.html)
