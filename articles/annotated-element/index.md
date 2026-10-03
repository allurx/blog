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

类上只写一个注解时，`getAnnotation()` 能正常读到；把它改成两个可重复注解后，同样的查询却可能返回 `null`。注解没有消失，只是编译器把重复项放进了容器，而这个查询方法不会展开容器。

`AnnotatedElement` 提供了几种不同的查询方式。选择时先确定两件事：是否需要展开可重复注解，是否允许从父类继承。下面用一组父子类对照结果，再把它们对应到 API 使用的几个术语。

本文按 Java SE 25 的公开 API 说明，完整程序只依赖标准库，目标环境是 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）。反射读取需要 `RUNTIME` 保留策略；容器的声明方式见[可重复注解](/repeatable-annotations/)。

## 同一个类，为什么能查出不同结果

假设有一个可重复且允许继承的 `Tag` 注解，父类和子类分别这样声明：

```java
@Tag(3)
static class Parent {}

@Tag(1)
@Tag(2)
static class RepeatedChild extends Parent {}

static class PlainChild extends Parent {}
```

`Parent` 直接携带一条 `Tag(3)`。`RepeatedChild` 重复使用了两次 `Tag`，编译后直接携带的是 `Tags` 容器，容器里保存 `1` 和 `2`。`PlainChild` 自己没有声明注解。

### 只查当前类，也要决定是否展开容器

`RepeatedChild.class.getDeclaredAnnotation(Tag.class)` 返回 `null`，因为当前类直接携带的注解类型是 `Tags`。改用 `getDeclaredAnnotationsByType(Tag.class)`，方法就会打开容器，得到 `1`、`2`。

这里的 `Declared` 限定查询在当前元素上；`ByType` 让方法识别可重复注解的容器。它们控制不同的查询行为。

### 允许继承时，本类结果怎样影响父类查询

`getAnnotation(Tag.class)` 不展开容器，所以在 `RepeatedChild` 上找不到直接的 `Tag`，接着沿父类查到 `Tag(3)`。

`getAnnotationsByType(Tag.class)` 则先展开子类自己的容器，已经得到 `1`、`2`，因此不会再拼接父类的 `3`。对于没有任何本地结果的 `PlainChild`，这个方法才会从父类取得 `3`。

这两次查询都允许继承，但“本类有没有结果”的判定方式不同。父子类上的注解不会自动合并成一个总表，合并是否合理要由框架自己的规则决定。

## 四种关系与六种方法

API 用四个术语精确定义前面的区别。它们描述查询关系，不是四种新的注解语法。

| 关系 | 在例子中的含义 |
| --- | --- |
| 直接存在 | `Parent` 直接携带 `Tag(3)`；`RepeatedChild` 直接携带 `Tags` |
| 间接存在 | `RepeatedChild` 的容器里包含 `Tag(1)`、`Tag(2)` |
| 存在 | 本类直接存在，或没有直接结果时按 `@Inherited` 规则查询父类 |
| 关联 | 本类直接或间接存在，或两者都没有结果时按继承规则查询父类 |

方法与这些关系的对应如下：

| 方法 | 查询关系 | 展开容器 |
| --- | --- | --- |
| `getAnnotation(Class<T>)` | 存在 | 否 |
| `getAnnotations()` | 存在 | 否 |
| `getAnnotationsByType(Class<T>)` | 关联 | 是 |
| `getDeclaredAnnotation(Class<T>)` | 直接存在 | 否 |
| `getDeclaredAnnotations()` | 直接存在 | 否 |
| `getDeclaredAnnotationsByType(Class<T>)` | 直接或间接存在 | 是 |

`isAnnotationPresent(type)` 等价于 `getAnnotation(type) != null`。它也不会展开容器，因此不能用它代替“`getAnnotationsByType` 的结果是否非空”。单独查询容器类型同样合法，此时得到的是容器，而不是容器中的各个元素。

继承还有限定：`@Inherited` 只沿类的父类链生效，不会自动把接口、方法或字段注解继承过来。可重复注解如果只使用一次，也通常直接存在，不必经过容器。

## 运行对照程序

下面的程序打印注解值，避免冗长的注解对象字符串掩盖查询差别。保存为 `AnnotationLookupDemo.java`：

```java
package io.allurx;

import java.lang.annotation.ElementType;
import java.lang.annotation.Inherited;
import java.lang.annotation.Repeatable;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.Arrays;

/**
 * @author allurx
 */
public class AnnotationLookupDemo {

    public static void main(String[] args) {
        System.out.println("子类直接查询: "
                + RepeatedChild.class.getDeclaredAnnotation(Tag.class));
        System.out.println("子类展开容器: "
                + values(RepeatedChild.class.getDeclaredAnnotationsByType(Tag.class)));
        System.out.println("子类普通继承查询: "
                + RepeatedChild.class.getAnnotation(Tag.class).value());
        System.out.println("子类 ByType 查询: "
                + values(RepeatedChild.class.getAnnotationsByType(Tag.class)));
        System.out.println("空子类直接查询: "
                + values(PlainChild.class.getDeclaredAnnotationsByType(Tag.class)));
        System.out.println("空子类 ByType 查询: "
                + values(PlainChild.class.getAnnotationsByType(Tag.class)));
    }

    private static String values(Tag[] tags) {
        return Arrays.toString(Arrays.stream(tags).mapToInt(Tag::value).toArray());
    }

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Inherited
    public @interface Tags {
        Tag[] value();
    }

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Inherited
    @Repeatable(Tags.class)
    public @interface Tag {
        int value();
    }

    @Tag(3)
    static class Parent {}

    @Tag(1)
    @Tag(2)
    static class RepeatedChild extends Parent {}

    static class PlainChild extends Parent {}
}
```

编译并运行：

```shell
javac -encoding UTF-8 -d out AnnotationLookupDemo.java
java -cp out io.allurx.AnnotationLookupDemo
```

输出对应六次查询：

```text
子类直接查询: null
子类展开容器: [1, 2]
子类普通继承查询: 3
子类 ByType 查询: [1, 2]
空子类直接查询: []
空子类 ByType 查询: [3]
```

第三行和第四行尤其值得对照：同一个子类上，普通查询取得父类的 `3`，`ByType` 查询却取得本类的 `1`、`2`。这由两种方法的查询规则共同决定，不是随机的反射行为。

## 查询范围之外，还要选对注解位置

`Field.getDeclaredAnnotations()` 读取字段声明上的注解；`List<@Sensitive String>` 中 `String` 的注解属于类型使用，要从 `Field.getAnnotatedType()` 进入参数化类型后读取。方法返回值、数组维度和通配符边界也有各自的位置，详见 [AnnotatedType](/annotated-type/)。

因此，实现注解解析时，可以先确定要读的是声明还是类型使用，再决定是否展开容器、是否继承。若业务确实要求合并父子类结果，就显式定义覆盖与顺序规则；把所有结果直接塞进一个 `Map`，会丢失之后还需要判断的位置和来源。

## 资料来源

- [AnnotatedElement：四种关系与查询方法表](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html)
- [Inherited：类继承的适用范围](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Inherited.html)
