---
title: "Repeatable 注解"
date: 2019-10-29
updated: 2026-10-03
tags:
  - Java
  - Annotation
domain: Java
---

@Repeatable 允许同一种注解在同一元素上写多次，编译器用容器注解表示这些重复项。反射读取时应区分“元素上的容器”和“容器里的注解”，否则同一注解写一次与写两次可能得到完全不同的查询结果。

本文采用 Java 25 注解与反射契约。下面两个 Test 定义只依赖标准库，已在 Oracle JDK 25.0.2 下编译，并使用 javap 确认容器表示；它们用于 class 文件检查，没有 main。

## 容器首先是一个普通注解

在没有 @Repeatable 语法时，可以显式写出容器。容器的 value 返回元素注解数组：

```java
package io.allurx;

import io.allurx.Test.MyAnnotation;
import io.allurx.Test.RepeatableAnnotation;

import java.lang.annotation.*;

/**
 * @author allurx
 */
@RepeatableAnnotation({@MyAnnotation(1), @MyAnnotation(2)})
public class Test {

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface RepeatableAnnotation {

        MyAnnotation[] value();
    }

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface MyAnnotation {

        int value();
    }
}
```

这段程序可独立保存为 Test.java。它表明容器结构本身不依赖重复书写语法；反射直接查询 RepeatableAnnotation 可以取得容器，再读取 value。

## @Repeatable 把重复语法连接到容器类型

下面在 MyAnnotation 上指定容器，使用处便可以重复写 MyAnnotation。另存到独立目录的 Test.java，避免与前一个同名类冲突。

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

## 编译后观察实际保存的结构

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

需要按类继承查找时使用 getAnnotationsByType，并理解 @Inherited 与本类结果覆盖父类搜索的规则。完整运行程序见 [AnnotatedElement](/annotated-element/)，它同时对照六种查询，不需要应用依赖编译器内部实现类。

## 资料来源

- [Repeatable：容器定义](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Repeatable.html)
- [JLS 9.6.3：可重复注解类型的约束](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.6.3)
- [AnnotatedElement：容器展开与继承](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html)
