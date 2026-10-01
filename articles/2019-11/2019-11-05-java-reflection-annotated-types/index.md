---
title: AnnotatedType
date: 2019-11-05
updated: 2026-10-01
id: 2019-11-05-java-reflection-annotated-types
tags:
  - Java
  - Reflect
  - AnnotatedType
domain: Java
---

## 核心结论

`AnnotatedType` 描述一次类型使用及其注解，例如 `List<@Sensitive String>` 中的 `String`。它与声明上的注解不同，需要沿着带注解的类型参数、数组组件、通配符边界和类型变量边界读取；`getType()` 则返回相应的普通 `Type` 结构。

## 问题与适用范围

本文回答如何读取嵌套类型位置上的注解，围绕 Java 8 引入的类型注解 API 展开。运行时可读取的注解需要相应保留策略。原文输出中的 `sun.reflect.annotation.*` 和 `AnnotatedTypeBaseImpl` 是旧实现类，未给出精确 JDK 修订；业务代码应依赖公开接口，不以内部类名判断类型。

<!-- more -->

## AnnotatedType

我们先来看一下AnnotatedType的定义：

```java
package java.lang.reflect;

public interface AnnotatedType extends AnnotatedElement {

    public Type getType();
}

```

可以发现AnnotatedType继承了我们在上篇文章中介绍的AnnotatedElement，也就是说通过AnnotatedType我们就能获取该类型的元素上的所有注解。同时类中定义了一个getType方法，这个方法的返回值则代表了运行时的对象的Type，可能是Class、ParameterizedType、TypeVariable、WildcardType、GenericArrayType中的任何一种。所以我们可以把AnnotatedType当做的Type的一种加强类型，通过这种类型我们就能基于反射获取元素上的所有注解。下面我们来看一下它的子接口一共有几种：

![](./images/annotated-type.png)

图中包含四个公开子接口和原文展示的基础实现类 AnnotatedTypeBaseImpl；实现类不属于公开分类契约，它们分别代表AnnotatedParameterizedType（被注解的参数化类型）、AnnotatedTypeVariable（被注解的类型变量）、AnnotatedWildcardType（被注解的通配符类型）、AnnotatedArrayType（被注解的数组类型）、AnnotatedTypeBaseImpl（被注解的基础类型（除了以上四种类型以外的其它类型）），下面我们一一介绍这五种类型的具体含义。

### AnnotatedParameterizedType

AnnotatedParameterizedType是指那些**可能**带注解的ParameterizedType类型的数据，例如`List<String> list`是一个ParameterizedType，同时也是一个AnnotatedParameterizedType，只不过此时它本身没有带注解而已，当然啦，它的类型参数`<String>`也是有可能带注解的任何AnnotatedType，所以AnnotatedParameterizedType提供了getAnnotatedActualTypeArguments方法来获取带注解的类型参数。

```java
package java.lang.reflect;

public interface AnnotatedParameterizedType extends AnnotatedType {

    AnnotatedType[] getAnnotatedActualTypeArguments();
}

```

下面看一个例子：

```java

package io.allurx;

import java.lang.annotation.*;
import java.lang.reflect.AnnotatedParameterizedType;
import java.util.Arrays;
import java.util.List;

/**
 * @author allurx
 */
public class AnnotatedParameterizedTypeTest {

    public List<@MyAnnotation(1) String> list1;

    public List<@MyAnnotation(2) List<@MyAnnotation(3) String>> list2;

    public static void main(String[] args) {
        Arrays.stream(AnnotatedParameterizedTypeTest.class.getDeclaredFields()).forEach(field -> print((AnnotatedParameterizedType) field.getAnnotatedType()));
    }

    private static void print(AnnotatedParameterizedType annotatedParameterizedType) {
        Arrays.stream(annotatedParameterizedType.getAnnotatedActualTypeArguments())
                .forEach(annotatedType -> {
                            System.out.println(Arrays.toString(annotatedType.getDeclaredAnnotations()));
                            if (annotatedType instanceof AnnotatedParameterizedType) {
                                print((AnnotatedParameterizedType) annotatedType);
                            }
                        }
                );
    }

    @Target({ElementType.FIELD, ElementType.TYPE_USE, ElementType.TYPE, ElementType.PARAMETER})
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface MyAnnotation {

        int value();
    }
}
```

控制台输出

```java
[@io.allurx.AnnotatedParameterizedTypeTest$MyAnnotation(value=1)]
[@io.allurx.AnnotatedParameterizedTypeTest$MyAnnotation(value=2)]
[@io.allurx.AnnotatedParameterizedTypeTest$MyAnnotation(value=3)]
```

在上面的例子中定义两个ParameterizedType的域，然后通过Field的getAnnotatedType方法获取其对应的AnnotatedType，也就是AnnotatedParameterizedType，然后递归打印类型参数上的注解。

### AnnotatedTypeVariable

AnnotatedTypeVariable是指那些**可能**带注解的TypeVariable类型的数据，例如`T t`是一个TypeVariable类型的值，同时也是一个AnnotatedTypeVariable类型的值，只不过此时它本身没有带注解而已，当了啦类型变量本身是带边界的，所以它的所有边界都有可能是带注解的任何AnnotatedType，所以AnnotatedTypeVariable提供了getAnnotatedBounds方法来获取所有带注解的边界。

```java
package java.lang.reflect;

public interface AnnotatedTypeVariable extends AnnotatedType {

    AnnotatedType[] getAnnotatedBounds();
}
```

下面看一个例子：

```java
package io.allurx;

import io.allurx.AnnotatedTypeVariableTest.MyAnnotation;

import java.io.Serializable;
import java.lang.annotation.*;
import java.lang.reflect.AnnotatedTypeVariable;
import java.util.Arrays;

/**
 * @author allurx
 */
public class AnnotatedTypeVariableTest<T extends @MyAnnotation(1) Number & @MyAnnotation(2) Cloneable & @MyAnnotation(3) Serializable> {

    public T t;

    public static void main(String[] args) throws Exception {
        AnnotatedTypeVariable annotatedTypeVariable = (AnnotatedTypeVariable) AnnotatedTypeVariableTest.class.getDeclaredField("t").getAnnotatedType();
        Arrays.stream(annotatedTypeVariable.getAnnotatedBounds()).forEach(annotatedType -> System.out.println(Arrays.toString(annotatedType.getDeclaredAnnotations())));
    }

    @Target({ElementType.FIELD, ElementType.TYPE_USE, ElementType.TYPE, ElementType.PARAMETER})
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface MyAnnotation {

        int value();
    }
}
```

控制台输出

```java
[@io.allurx.AnnotatedTypeVariableTest$MyAnnotation(value=1)]
[@io.allurx.AnnotatedTypeVariableTest$MyAnnotation(value=2)]
[@io.allurx.AnnotatedTypeVariableTest$MyAnnotation(value=3)]
```

在上面的例子中定义了一个TypeVariable类型的域t，然后通过反射获取该域的AnnotatedType，也就是AnnotatedTypeVariable，然后通过AnnotatedTypeVariable提供的getAnnotatedBounds方法获取T的所有AnnotatedType边界，最后打印所有边界上的注解。

### AnnotatedWildcardType

AnnotatedWildcardType是指那些**可能**带注解的WildcardType类型的数据，当然其上限或下限本身可能也是带注解的类型。

```java
package java.lang.reflect;

public interface AnnotatedWildcardType extends AnnotatedType {

    AnnotatedType[] getAnnotatedLowerBounds();

    AnnotatedType[] getAnnotatedUpperBounds();
}
```

下面看一个例子：

```java
package io.allurx;

import java.lang.annotation.*;
import java.lang.reflect.AnnotatedParameterizedType;
import java.lang.reflect.AnnotatedWildcardType;
import java.util.Arrays;
import java.util.List;

/**
 * @author allurx
 */
public class AnnotatedWildcardTypeTest {

    public List<? extends @MyAnnotation(1) Number> list1;

    public List<? super @MyAnnotation(2) Number> list2;

    public static void main(String[] args) {
        Arrays.stream(AnnotatedWildcardTypeTest.class.getDeclaredFields())
                .forEach(field -> {
                    AnnotatedParameterizedType annotatedParameterizedType = (AnnotatedParameterizedType) field.getAnnotatedType();
                    print((AnnotatedWildcardType) annotatedParameterizedType.getAnnotatedActualTypeArguments()[0]);
                });
    }

    private static void print(AnnotatedWildcardType annotatedWildcardType) {
        Arrays.stream(annotatedWildcardType.getAnnotatedUpperBounds()).forEach(annotatedType -> System.out.println(Arrays.toString(annotatedType.getDeclaredAnnotations())));
        Arrays.stream(annotatedWildcardType.getAnnotatedLowerBounds()).forEach(annotatedType -> System.out.println(Arrays.toString(annotatedType.getDeclaredAnnotations())));
    }

    @Target({ElementType.FIELD, ElementType.TYPE_USE, ElementType.TYPE, ElementType.PARAMETER})
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface MyAnnotation {

        int value();
    }
}
```
控制台输出
```java
[@io.allurx.AnnotatedWildcardTypeTest$MyAnnotation(value=1)]
[@io.allurx.AnnotatedWildcardTypeTest$MyAnnotation(value=2)]
```

在上面的例子中定义了一个AnnotatedParameterizedType类型的域，然后通过反射获取该域的WildcardType的类型参数，同样也就是AnnotatedWildcardType，然后通过AnnotatedWildcardType提供的getAnnotatedUpperBounds和getAnnotatedLowerBounds方法获取上下AnnotatedType边界，最后打印所有边界上的注解。

### AnnotatedArrayType

AnnotatedArrayType是指那些**可能**带注解的**数组类型**的数据，当然啦其内部元素类型本身也可能是带注解的类型。注意AnnotatedArrayType代表的是所有数组类型（包含普通类型数组和泛型数组），而不是单指Type的子接口GenericArrayType，GenericArrayType只代表那些泛型数组。

```java
package java.lang.reflect;

public interface AnnotatedArrayType extends AnnotatedType {

    AnnotatedType  getAnnotatedGenericComponentType();
}
```

AnnotatedArrayType提供了一个getAnnotatedGenericComponentType方法来获取内部元素带注解的类型。下面看一个例子：

```java

package io.allurx;

import io.allurx.AnnotatedArrayTypeTest.MyAnnotation;

import java.lang.annotation.*;
import java.lang.reflect.AnnotatedArrayType;
import java.lang.reflect.AnnotatedParameterizedType;
import java.lang.reflect.AnnotatedType;
import java.lang.reflect.AnnotatedTypeVariable;
import java.util.Arrays;
import java.util.List;

/**
 * @author allurx
 */
public class AnnotatedArrayTypeTest<T extends @MyAnnotation(8) Number> {

    public @MyAnnotation(1) String @MyAnnotation(2) [] array1;

    public @MyAnnotation(3) List<@MyAnnotation(4) String> @MyAnnotation(5) [] array2;

    public @MyAnnotation(6) T @MyAnnotation(7) [] array3;

    // 注意二维数组第一个[]代表的是二维数组本身，第二个[]代表的是二维数组的组件本身，所以@MyAnnotation(10)
    // 是二维数组本身上的注解，@MyAnnotation(11)是二维数组的组件本身上的注解，@MyAnnotation(9)是二维数组
    // 组件类型上的注解
    public @MyAnnotation(9) String @MyAnnotation(10) [] @MyAnnotation(11) [] array4;

    public static void main(String[] args) {
        Arrays.stream(AnnotatedArrayTypeTest.class.getDeclaredFields()).forEach(field -> {
            print((AnnotatedArrayType) field.getAnnotatedType());
        });
    }

    private static void print(AnnotatedArrayType annotatedArrayType) {
        AnnotatedType annotatedGenericComponentType = annotatedArrayType.getAnnotatedGenericComponentType();
        // 获取域上的注解，即[]上的注解
        System.out.println(Arrays.toString(annotatedArrayType.getDeclaredAnnotations()));
        // 获取组件上的注解，即数组元素类型上的注解
        System.out.println(Arrays.toString(annotatedGenericComponentType.getDeclaredAnnotations()));
        // 获取组件类型为AnnotatedParameterizedType的泛型参数上的注解
        if (annotatedGenericComponentType instanceof AnnotatedParameterizedType) {
            AnnotatedParameterizedType annotatedParameterizedType = (AnnotatedParameterizedType) annotatedGenericComponentType;
            System.out.println(Arrays.toString(annotatedParameterizedType.getAnnotatedActualTypeArguments()[0].getDeclaredAnnotations()));
            // 获取组件类型为AnnotatedTypeVariable的所有边界上的注解
        } else if (annotatedGenericComponentType instanceof AnnotatedTypeVariable) {
            AnnotatedTypeVariable annotatedTypeVariable = (AnnotatedTypeVariable) annotatedGenericComponentType;
            Arrays.stream(annotatedTypeVariable.getAnnotatedBounds()).forEach(annotatedType -> System.out.println(Arrays.toString(annotatedType.getDeclaredAnnotations())));
            // 递归获取组件类型为AnnotatedArrayType上的注解
        } else if (annotatedGenericComponentType instanceof AnnotatedArrayType) {
            print((AnnotatedArrayType) annotatedGenericComponentType);
        }
    }

    @Target({ElementType.FIELD, ElementType.TYPE_USE, ElementType.TYPE, ElementType.PARAMETER})
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface MyAnnotation {

        int value();
    }
}

```

控制台输出

```java
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=2)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=1)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=5)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=3)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=4)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=7)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=6)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=8)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=10)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=11)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=11)]
[@io.allurx.AnnotatedArrayTypeTest$MyAnnotation(value=9)]
```

在上面的例子中分别定义了组件类型为普通类型、ParameterizedType、TypeVariable以及数组类型的四个数组，然后通过反射分别打印数组本身上的注解以及数组组件本身上的注解。在这些例子中我们需要明确注解放置的位置代表的不同含义，对于数组本身来说，放置在[]上代表的是其本身上的注解，放置在其类型定义上的注解代表的是其组件类型上的注解。

### AnnotatedTypeBaseImpl

除了以上四种类型以外的类型，它们都被统一规整为AnnotatedTypeBaseImpl，这是`sun.reflect.annotation`包下的一个私有的内部类，当然了以上四种类型的具体实现也在这个包下，同样它们也都是私有的内部类。下面举一个简单的例子看一下什么样的类型才是AnnotatedTypeBaseImpl。

```java


package io.allurx;

import java.util.Arrays;
import java.util.List;

/**
 * @author allurx
 */
public class AnnotatedTypeBaseImplTest<T> {

    private String a;

    private List<String> b;

    private T c;

    private String[] d;

    private T[] e;

    public static void main(String[] args) {
        Arrays.stream(AnnotatedTypeBaseImplTest.class.getDeclaredFields())
                .forEach(field -> System.out.println(field.getAnnotatedType().getClass()));
    }
}
```

控制台输出

```java
class sun.reflect.annotation.AnnotatedTypeFactory$AnnotatedTypeBaseImpl
class sun.reflect.annotation.AnnotatedTypeFactory$AnnotatedParameterizedTypeImpl
class sun.reflect.annotation.AnnotatedTypeFactory$AnnotatedTypeVariableImpl
class sun.reflect.annotation.AnnotatedTypeFactory$AnnotatedArrayTypeImpl
class sun.reflect.annotation.AnnotatedTypeFactory$AnnotatedArrayTypeImpl
```

可以看到，只要数据的Type不是ParameterizedType、TypeVariable、数组类型（包含普通数组和泛型数组）这三种类型，那么剩下的数据类型都会被规整为AnnotatedTypeBaseImpl。

## 应用

通过AnnotatedType能够实现很多有趣的事情。我在业余时间编写了一个数据脱敏库，通过AnnotatedType并结合反射api去分析获取那些十分复杂的数据结构中的注解从而达到数据脱敏的目的。

[一个简单易用的数据脱敏库](https://github.com/allurx/desensitization)

## 总结

AnnotatedType是jdk1.8之后新增的**可能被注解的类型**，公开 API 通过 AnnotatedParameterizedType、AnnotatedTypeVariable、AnnotatedWildcardType 和 AnnotatedArrayType 描述特殊类型使用，其他类型使用可直接按 AnnotatedType 处理；AnnotatedTypeBaseImpl 是原文中的内部实现类。同时AnnotatedType继承了AnnotatedElement使得我们能够在运行时基于反射api去分析获取那些十分复杂的数据结构中的注解。

## 资料来源

- [AnnotatedType：类型使用上的注解](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedType.html)
- [AnnotatedParameterizedType：带注解的类型参数](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedParameterizedType.html)
