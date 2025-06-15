---
title: Repeatable注解
date: 2019-10-29
categories:
- Java
- Annotation
tags:
- Java
- Annotation
---

# 概述

jdk1.8之后添加了一个新的元注解`@Repeatable`，被该注解标记的注解表明是一个可以重复注解的注解。也就是说该注解可以重复的注解某个元素。

<!-- more -->

# 用法

在jdk1.8之前，如果我们想要实现这个功能，我们不得不定义两个注解，其中一个注解的方法返回值是另一个注解数组。比如下面的这段代码：

```java
package com.zyc;

import com.zyc.Test.MyAnnotation;
import com.zyc.Test.RepeatableAnnotation;

import java.lang.annotation.*;

/**
 * @author zyc
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

我们不得不借助这两个注解来组成一个**可重复注解**，在jdk1.8之后情况得到了改善，新增了一个名为`@Repeatable`的注解，先看一下它的定义：

```java
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.ANNOTATION_TYPE)
public @interface Repeatable {
	// 需要重复注解的class
    Class<? extends Annotation> value();
}
```

从注释上我们可以看出要定义一个能够重复的注解，首先我们需要定一个容器注解来包含这个能够重复的注解，并且这个容器注解的必须拥有一个返回需要重复注解数组的value方法。咋一看好像有点绕，其实Repeatable的原理和我们原先的实现方式是一样的，原先我们是在另一个注解的value方法显示的另一个返回注解数组，而使用Repeatable之后，我们则可以直接在元素上重复使用某个注解。接下来我们看一个定义可重复注解的例子，在原先RepeatableAnnotation和MyAnnotation的基础上做了一些小改动：

```java
package com.zyc;

import com.zyc.Test.MyAnnotation;

import java.lang.annotation.*;

/**
 * @author zyc
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

在MyAnnotation上加上Repeatable注解，并指定存放的容器为RepeatableAnnotation之后，现在就可以直接在元素上重复使用MyAnnotation了。在使用和定义上和我们原先使用的方式大相径庭。那么Repeatable的实现原理是什么呢？我们反编译刚刚的Test类，发现在Test类上我们原先的两个MyAnnotation注解被包含到RepeatableAnnotation之中了

```java
@Test.RepeatableAnnotation({@Test.MyAnnotation(1), @Test.MyAnnotation(2)})
```

原来Repeatable背后的原理和我一开始实现的方式是一样的，只不过是一个语法糖而已。不过其中有一些需要注意的细节，**可重复注解最终是以另一个注解的value值的数组形式存在于class中的，所以此时通过反射的getDeclaredAnnotation方法获取可重复注解时，获取到的是容器注解。同时如果元素上的可重复注解只有一个时，最终的class中重复注解并不会被存放到容器注解，而是以直接的形式存放在元素上，此时通过反射的getDeclaredAnnotation方法是能获取到该注解的，所以当我们使用反射获取可重复注解时需要额外的关注这些细节。**

# 总结

使用Repeatable时，我们需要先定义一个容器注解，在它的value方法中返回一个需要重复的注解的数组，然后再将Repeatable注解注释到我们需要重复的注解上并指明value为容器注解的class。Repeatable实现的原理和我们自己通过组合注解来实现是一样的，只不过是一个语法糖而已。

