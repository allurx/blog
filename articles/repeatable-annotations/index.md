---
title: 可重复注解为什么需要容器
date: 2019-10-29
updated: 2026-10-03
tags:
  - Java
  - Annotation
domain: Java
---

一个注解写一次时，`getDeclaredAnnotation()` 能读到它；再加一个同类型注解，查询却返回 `null`。这并不意味着第二个注解覆盖了第一个，而是多个注解被放进了容器，原来的查询没有继续展开它。

`@Repeatable` 把重复书写的语法与容器类型关联起来。先看容器如何表达数组，再看编译和反射怎样使用它，就能解释单个与多个注解的差别。

本文采用 Java 25 注解与反射契约。下面的 `Test` 只依赖标准库，可在 Oracle JDK 25.0.2 下编译，并使用 `javap` 检查容器表示；它用于 class 文件检查，没有 `main`。

## 容器首先是一个普通注解

如果需要在一个类上记录两个整数，普通注解也能表达：先定义元素注解，再让另一个注解的 `value` 返回元素数组。使用处写成下面这样，定义见下一节的完整程序：

```java
@RepeatableAnnotation({@MyAnnotation(1), @MyAnnotation(2)})
class Example {
}
```

这时，类上直接出现的是 `RepeatableAnnotation`，内部才是两个 `MyAnnotation`。反射先取得容器、再读取 `value()`，就能拿到 1 和 2。容器结构本身不依赖重复书写语法。

## 用 @Repeatable 省去使用处的容器写法

### 在元素注解上声明容器类型

在 `MyAnnotation` 上指定容器后，使用处就能连续写两次 `MyAnnotation`。下面是完整定义，保存为 `Test.java`：

```java
package io.allurx;

import io.allurx.Test.MyAnnotation;

import java.lang.annotation.*;

/**
 * @author allurx
 */
@MyAnnotation(1)
@MyAnnotation(2)
public class Test {

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface RepeatableAnnotation {

        MyAnnotation[] value();
    }

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Repeatable(RepeatableAnnotation.class)
    @Documented
    public @interface MyAnnotation {

        int value();
    }

}
```

容器还须符合语言规则：value 返回正确的注解数组，其他元素需要默认值，保留策略、目标范围以及 Documented、Inherited 等关系也有限制。不能只添加 @Repeatable 就任意选择一个注解作容器，具体规则见 JLS 9.6.3。

### 编译器仍然用容器保存重复项

```shell
javac -encoding UTF-8 -d out Test.java
javap -v -classpath out io.allurx.Test
```

在 RuntimeVisibleAnnotations 部分可以看到 RepeatableAnnotation，其 value 包含两个 MyAnnotation，值分别为 1、2。对应的源码表示可写成下面的结构；这是结构示意，不是声称 javap 输出 Java 源代码：

```java
@Test.RepeatableAnnotation({@Test.MyAnnotation(1), @Test.MyAnnotation(2)})
```

只有一个 MyAnnotation 时通常直接存储该注解，不需要容器。因此“可重复类型”不等于每次使用都会生成容器。

## 消费者用 ByType 统一单个与多个结果

| 查询 | 单个直接注解 | 多个注解通过容器表示 |
| --- | --- | --- |
| getDeclaredAnnotation(MyAnnotation.class) | 可以取得 | 不展开容器，通常为 null |
| getDeclaredAnnotationsByType(MyAnnotation.class) | 返回单元素数组 | 展开容器并返回全部元素 |

如果消费者关心的是“这个类配置了哪些 `MyAnnotation`”，使用 `getDeclaredAnnotationsByType()` 就可以让单个和多个结果都进入同一条数组处理路径。只有需要研究容器本身时，才直接查询 `RepeatableAnnotation`。

需要按类继承查找时使用 `getAnnotationsByType()`，并理解 `@Inherited` 与本类结果覆盖父类搜索的规则。完整运行程序见 [AnnotatedElement](/annotated-element/)，其中对照了六种查询。

## 资料来源

- [Repeatable：容器定义](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Repeatable.html)
- [JLS 9.6.3：可重复注解类型的约束](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.6.3)
- [AnnotatedElement：容器展开与继承](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html)
