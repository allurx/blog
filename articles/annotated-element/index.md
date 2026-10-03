---
title: AnnotatedElement
date: 2019-11-04
updated: 2026-10-03
tags:
  - Java
  - Reflect
  - AnnotatedElement
domain: Java
---

读取注解时，首先要回答三个问题：只读当前元素吗，是否展开可重复注解的容器，是否按 @Inherited 查父类？AnnotatedElement 把这三件事组合成不同方法，选错方法会出现“明明写了注解却读不到”的现象。

本文用同一组注解比较查询结果。下面的完整程序仅依赖 JDK 标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。需要先了解 [可重复注解与容器](/repeatable-annotations/)。反射读取要求 RUNTIME 保留策略，@Inherited 只影响类的父类链，不把接口、方法或字段注解自动继承过来。

## 四种关系解释查询范围

| 关系 | 含义 |
| --- | --- |
| 直接存在 | 元素直接携带该注解 |
| 间接存在 | 元素直接携带容器，容器 value 数组包含该可重复注解 |
| 存在 | 本元素直接存在；或者本元素没有直接结果，按类继承和 @Inherited 规则从父类继承 |
| 关联 | 本元素直接或间接存在；本元素都没有结果时，再按继承规则查父类 |

单个可重复注解通常直接存在，重复写多个时编译器使用容器表示。因此“可重复注解”不等于“间接存在”。父类搜索也不是无条件合并：getAnnotationsByType 在本类已经找到结果时，不再拼接父类的同类注解。

## 六种查询方法如何选择

| 方法 | 查询关系 | 展开容器 |
| --- | --- | --- |
| getAnnotation(Class&lt;T&gt;) | 存在 | 否 |
| getAnnotations() | 存在 | 否 |
| getAnnotationsByType(Class&lt;T&gt;) | 关联 | 是 |
| getDeclaredAnnotation(Class&lt;T&gt;) | 直接存在 | 否 |
| getDeclaredAnnotations() | 直接存在 | 否 |
| getDeclaredAnnotationsByType(Class&lt;T&gt;) | 直接或间接存在 | 是 |

isAnnotationPresent 按“存在”判断，不等价于 getAnnotationsByType 的结果非空。容器类型也是一个注解类型，查询容器与查询它包含的元素注解会得到不同结果。

## 用一个程序观察容器与继承

A 和 B 都重复使用 MyAnnotation，编译后分别携带 RepeatableAnnotation 容器。两种注解都使用 RUNTIME 与 @Inherited，容器 value 返回 MyAnnotation 数组。

保存为 Test.java，执行 `javac -encoding UTF-8 -d out Test.java`、`java -cp out io.allurx.Test`：

```java
package io.allurx;

import java.lang.annotation.*;
import java.util.Arrays;

/**
 * @author allurx
 */
public class Test {

    public static void main(String[] args) {
        // A类上是否“存在”MyAnnotation注解
        System.out.println(A.class.isAnnotationPresent(MyAnnotation.class));

        // A类上是否“存在”RepeatableAnnotation注解
        System.out.println(A.class.isAnnotationPresent(RepeatableAnnotation.class));

        // 如果A类上“存在”MyAnnotation注解，则返回该注解，否则返回null
        System.out.println(A.class.getAnnotation(MyAnnotation.class));

        // 如果A类上“存在”RepeatableAnnotation注解，则返回该注解，否则返回null
        System.out.println(A.class.getAnnotation(RepeatableAnnotation.class));

        // 获取A类上所有“存在”的注解
        System.out.println(Arrays.toString(A.class.getAnnotations()));

        // 如果指定的注解是与A类“关联的”，则返回该注解，否则再去它的父类中取寻找。
        // 如果参数注解是可重复注解，则会从该元素上的容器注解中寻找该重复注解并返回。
        System.out.println(Arrays.toString(A.class.getAnnotationsByType(MyAnnotation.class)));
        System.out.println(Arrays.toString(A.class.getAnnotationsByType(RepeatableAnnotation.class)));

        // 获取“直接存在”与该元素上的所有注解
        System.out.println(Arrays.toString(A.class.getDeclaredAnnotations()));

        // 获取“直接存在”于该元素上的指定注解
        System.out.println(A.class.getDeclaredAnnotation(MyAnnotation.class));
        System.out.println(A.class.getDeclaredAnnotation(RepeatableAnnotation.class));

        // 获取“直接存在”或者“间接存在”于该元素上的注解
        System.out.println(Arrays.toString(A.class.getDeclaredAnnotationsByType(MyAnnotation.class)));
        System.out.println(Arrays.toString(A.class.getDeclaredAnnotationsByType(RepeatableAnnotation.class)));
    }

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Inherited
    @Documented
    public @interface RepeatableAnnotation {

        MyAnnotation[] value();
    }

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Repeatable(RepeatableAnnotation.class)
    @Inherited
    @Documented
    public @interface MyAnnotation {

        int value();
    }

    @MyAnnotation(1)
    @MyAnnotation(2)
    static class A extends B {

    }

    @MyAnnotation(3)
    @MyAnnotation(4)
    static class B {

    }

}
```

下面是 JDK 25 的实际输出；toString 的标点和类名排版不是 API 保证，应对照每行查询的语义：

```text
false
true
null
@io.allurx.Test.RepeatableAnnotation({@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)})
[@io.allurx.Test.RepeatableAnnotation({@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)})]
[@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)]
[@io.allurx.Test.RepeatableAnnotation({@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)})]
[@io.allurx.Test.RepeatableAnnotation({@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)})]
null
@io.allurx.Test.RepeatableAnnotation({@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)})
[@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)]
[@io.allurx.Test.RepeatableAnnotation({@io.allurx.Test.MyAnnotation(1), @io.allurx.Test.MyAnnotation(2)})]
```

前两行 false、true 表明 A 上存在的是容器，而不是一个可直接读取的 MyAnnotation。getAnnotation(MyAnnotation.class) 也不会展开父类的容器，所以返回 null；ByType 方法则展开 A 上的 1、2，不合并 B 上的 3、4。

如果把 B 改为只标注一个 MyAnnotation(3)，B 上便直接存在该注解。按 API 规则，A 的 getAnnotation(MyAnnotation.class) 可以沿继承链读到 3，而 getAnnotationsByType(MyAnnotation.class) 仍使用 A 自己容器里的 1、2。这个对照说明“存在”和“关联”解决的是不同查询问题，不能把两个结果互相代替。

## 声明注解与类型使用注解不要混读

Field.getDeclaredAnnotations 读取字段声明上的注解；List<@Sensitive String> 中 String 的注解属于类型使用，要从 Field.getAnnotatedType 递归进入参数化类型读取。方法返回值、数组维度与通配符边界也有同样的区别，见 [AnnotatedType](/annotated-type/)。

解析框架应先确定自己的继承和重复注解政策，再选择对应方法；不要先把所有注解平铺到一个 Map，之后才试图恢复容器、声明位置和覆盖关系。

## 资料来源

- [AnnotatedElement：四种关系与查询方法表](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html)
- [Inherited：类继承的适用范围](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Inherited.html)
