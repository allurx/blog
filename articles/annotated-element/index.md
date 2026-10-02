---
title: AnnotatedElement
date: 2019-11-04
updated: 2026-10-02
tags:
  - Java
  - Reflect
  - AnnotatedElement
domain: Java
---

读取注解前，需要明确是读取本元素、展开可重复注解，还是按 `@Inherited` 查找父类。`getDeclaredAnnotation()` 只读直接存在的单个注解；`getDeclaredAnnotationsByType()` 可以展开容器；`getAnnotationsByType()` 还按契约处理类继承。选择方法比笼统地“获取所有注解”更重要。

`@Inherited` 只作用于类的父类查找，不把接口、方法或字段的注解自动继承过来。单个可重复注解可能直接存在，多个则可能通过容器间接存在；后面的反编译例子用于说明这一差异。


## 存在术语

在分析AnnotatedElement方法中的方法前我们必须要明确注解有几种方式存在于元素之上，这样才能便于我们更好的理解其中方法的含义。

###  直接存在

**直接存在**这种形式可能是我们再写代码时经常遇到的形式，简单的说就是某个元素直接被某个注解标注了。

```java
@MyAnnotation
public class Test{}
```

在上面的例子中，类Test被注解MyAnnotation直接标注了，这种形式就称为**直接存在**，所以此时MyAnnotation是**直接存在**于Test之上。

### 间接存在

**间接存在**这种形式是指在我们使用`@Repeatable`注解标记一个可重复注解时，将这个可重复注解标注在元素之上时，这个可重复注解就是**间接存在**于元素之上的。对`@Repeatable`底层实现原理不清楚的同学可以翻阅我之前写的文章，其本质上只是一个语法糖而已。

```java
package io.allurx;

import java.lang.annotation.*;
import java.util.Arrays;

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

在上面的例子中，MyAnnotation是一个可重复注解，Test类被标注了MyAnnotation，这种形式就称为**间接存在**，你可能会好奇为什么这种形式称为间接存在，其实通过反编译这个Test类，你会发现Test类上实际被标注的是RepeatableAnnotation注解，只不过是通过value数组指定了MyAnnotation，因此这种形式被称为**间接存在**。所以此时MyAnnotation是**间接存在**于Test之上，RepeatableAnnotation是**直接存在**于Test之上。

### 存在

**存在**这种形式是指满足以下任一条件，则代表元素上**存在**某个注解

1.  元素上**直接存在**某个注解
2. 某个被`@Inherited`标注的注解（能够继承的注解）**存在**于该元素的父类上

**简单的说就是某个元素上直接存在某个注解或者只要在该元素代表类的所有父类中找到一个直接标注该注解的父类，则代表该注解存在于元素之上。**

```java


package io.allurx;

import java.lang.annotation.*;
import java.util.Arrays;

/**
 * @author allurx
 */
public class Test {

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
    static class B{

    }

}
```

在上面的例子中可重复注解MyAnnotation注释在类A上（编译后的class中其实是被RepeatableAnnotation注释了），类A继承了类B，而类B也被可重复注解MyAnnotation注释了，注意类B上只有一个可重复注解，因此编译后的类B的class中是被MyAnnotation注释了。因此这里类A上**存在**注解RepeatableAnnotation和MyAnnotation这两个注解，而类B上**存在**MyAnnotation注解。

### 关联的

**关联的**这种形式是指满足以下任一条件，则代表元素与该注解是**关联的**

1. 元素上**直接存在**或者**间接存在**某个注解
2. 某个被`@Inherited`标注的注解（能够继承的注解）与该元素的父类是**关联的**

**简单点说就是元素上直接存在或者间接存在某个注解或者只要在该元素代表类的所有父类中找到一个直接存在或者间接存在该注解的父类，则代表元素与该注解是关联的。**

还是以上面**存在**中的例子作为解释，类A是与RepeatableAnnotation和MyAnnotation注解关联的，类B是与MyAnnotation注解关联的。

### 小结

AnnotatedElement中的方法都是基于**注解以何种形式存在于对象上**获取元素上的注解的， 下表总结了此接口中各方法获取元素注解的范围：
<table border>
        <tr align=center>
            <th colspan=2></th>
            <th colspan=4>注解存在的形式</th>
        <tr align=center>
            <th colspan=2>方法</th>
            <th>直接存在</th>
            <th>间接存在</th>
            <th>存在</th>
            <th>关联的</th>
        <tr align=center>
            <td>T</td>
            <td>getAnnotation(Class<T> annotationClass)
            <td></td>
            <td></td>
            <td>√</td>
            <td></td>
        </tr>
        <tr align=center>
            <td >Annotation[]</td>
            <td>getAnnotations()
            <td></td>
            <td></td>
            <td>√</td>
            <td></td>
        </tr>
        <tr align=center>
            <td>T[]</td>
            <td>getAnnotationsByType(Class<T> annotationClass)
            <td></td>
            <td></td>
            <td></td>
            <td>√</td>
        </tr>
        <tr align=center>
            <td>T</td>
            <td>getDeclaredAnnotation(Class<T> annotationClass)
            <td>√</td>
            <td></td>
            <td></td>
            <td></td>
        </tr>
        <tr align=center>
            <td>Annotation[]</td>
            <td>getDeclaredAnnotations()
            <td>√</td>
            <td></td>
            <td></td>
            <td></td>
        </tr>
        <tr align=center>
            <td>T[]</td>
            <td>getDeclaredAnnotationsByType(Class<T> annotationClass)
            <td>√</td>
            <td>√</td>
            <td></td>
            <td></td>
        </tr>
 </table>

 上面的表格中展现了AnnotatedElement中的方法获取元素上的注解时所探测的范围，其中打钩的范围代表该方法会探测以该种形式存在于元素上的注解。

## 例子

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

控制台输出

```java
false
true
null
@io.allurx.Test$RepeatableAnnotation(value=[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)])
[@io.allurx.Test$RepeatableAnnotation(value=[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)])]
[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)]
[@io.allurx.Test$RepeatableAnnotation(value=[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)])]
[@io.allurx.Test$RepeatableAnnotation(value=[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)])]
null
@io.allurx.Test$RepeatableAnnotation(value=[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)])
[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)]
[@io.allurx.Test$RepeatableAnnotation(value=[@io.allurx.Test$MyAnnotation(value=1), @io.allurx.Test$MyAnnotation(value=2)])]
```

要理解AnnotatedElement接口中的这些方法并不难，只要理解**直接存在**、**间接存在**、**存在**、**关联的**这些词的含义，在需要获取元素上的元素时，我们就能选择合适的方法了。

## 总结

注解可能会以各种形式存在于元素之上，一共分成以下四种形式：

1. **直接存在**
   某个注解直接标注在元素上
2. **间接存在**
   被`@Repeatable`注解标注的注解注释在元素上时，该注解就是间接存在于元素上的
3. **存在**
   某个**元素上直接存在**某个注解或者只要在该元素代表类的所有**父类中找到一个直接存在**该注解的父类，则代表该注解存在于元素之上
4. **关联的**
   **元素上直接存在或者间接存在**某个注解或者只要在该元素代表类的所有**父类中找到一个直接存在或者间接存在**该注解的父类，则代表元素与该注解是关联的

## 资料来源

- [AnnotatedElement：四种注解存在关系与查询表](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html)
- [Inherited：类继承范围](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Inherited.html)
