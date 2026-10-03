---
title: Java 反射怎样保留和展开泛型类型
date: 2019-10-29
updated: 2026-10-03
tags:
  - Java
  - Reflect
  - Type
domain: Java
---

为对象做序列化时，看到字段类型是 `List` 还不够：列表里应该放 `String`、某个业务对象，还是由外层泛型参数决定？`Field.getType()` 给出运行时类视图，`Field.getGenericType()` 则让我们继续读取声明中的类型实参。

后一个方法返回 `Type`。它可能表示 `List<String>`，也可能表示尚未确定的 `T`、通配符 `? super Number` 或数组 `T[]`。解析工作的起点因此是识别当前结构，再沿它包含的类型继续向内读取。

本文沿“从声明取出类型，再按结构展开”的路径认识五种标准表示。下面的完整程序仅依赖 JDK 标准库，已在 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）下编译运行。将五个完整类保存为同名 .java 文件，放在一个只含这些源文件的目录，执行 `javac -encoding UTF-8 -d out *.java`；各节给出对应运行命令。

## 先选择能保留签名的入口

普通对象的 getClass 只能得到运行时类，通常不能恢复创建该对象时传入的全部泛型实参。泛型信息来自字段、方法参数、返回值、父类和接口等声明保留的 Signature。例如 Field.getGenericType 与 Class.getGenericSuperclass 返回 Type，而 getType、getSuperclass 返回的是较窄的 Class 视图。

| 遇到的结构 | 主要读取内容 | 例子 |
| --- | --- | --- |
| Class | 普通类、接口、基本类型或可具体表示的数组 | String、int、String[] |
| ParameterizedType | 类型实参、原始类型、所有者 | List<String> |
| TypeVariable | 变量名、声明者、上界 | T extends Number |
| WildcardType | 通配符上下界 | ? super Integer |
| GenericArrayType | 泛型组件类型 | T[]、List<String>[] |

[![标准反射 API 的五种 Type 结构](./images/type.png)](./images/type.png)

这些是标准反射返回的主要结构，Type 并不是 sealed 接口，不能据此声称全世界只有五个实现类。解析器应按公开接口处理结构，不依赖 sun.reflect 下的具体实现类名。

## 展开参数化类型里的每一层

### ParameterizedType 同时描述原始类、实参和所有者

以 `List<List<String>>` 为例，外层的原始类型是 `List`，唯一实参仍是一个 `ParameterizedType`；继续展开，才会遇到内层实参 `String.class`。`getActualTypeArguments()` 返回 `Type[]` 正是为了表达这种递归结构。

`getRawType()` 读取参数化类型对应的原始类，`getOwnerType()` 则读取成员类型的所有者。下面分别选择成员类、顶级类和局部类作为父类，对照三个方法的结果。示例已知这些父类声明都是参数化类型，所以直接强转；通用解析器必须先判断返回的结构。

```java
package io.allurx;

import java.lang.reflect.ParameterizedType;
import java.util.Arrays;
import java.util.List;

/**
 * @author allurx
 */
public class ParameterizedTypeTest<T> {

    public static void main(String[] args) {
        class F<T> {
        }
        class E extends F<String> {

        }
        print(ParameterizedTypeTest.B.class);
        print(ParameterizedTypeTest.C.class);
        print(D.class);
        print(E.class);
    }

    private static void print(Class<?> clazz) {
        ParameterizedType type = (ParameterizedType) clazz.getGenericSuperclass();
        String str = clazz.getName() + "[" + Arrays.toString(type.getActualTypeArguments()) +
                "," +
                type.getRawType() +
                "," +
                type.getOwnerType() +
                "]";
        System.out.println(str);

    }

    static class A<T> {

    }

    static class B<T> extends ParameterizedTypeTest.A<T> {

    }

    static class C extends ParameterizedTypeTest.A<List<String>> {

    }
}

class D extends ParameterizedTypeTest<String> {
}
```

执行 `java -cp out io.allurx.ParameterizedTypeTest`：

```text
io.allurx.ParameterizedTypeTest$B[[T],class io.allurx.ParameterizedTypeTest$A,class io.allurx.ParameterizedTypeTest]
io.allurx.ParameterizedTypeTest$C[[java.util.List<java.lang.String>],class io.allurx.ParameterizedTypeTest$A,class io.allurx.ParameterizedTypeTest]
io.allurx.D[[class java.lang.String],class io.allurx.ParameterizedTypeTest,null]
io.allurx.ParameterizedTypeTest$1E[[class java.lang.String],class io.allurx.ParameterizedTypeTest$1F,null]
```

B 的实参仍是变量 T，C 的实参是 List<String>，因此需要递归解析。A 是 ParameterizedTypeTest 的成员类，所以有所有者；D 的父类是顶级类，E 的父类 F 是局部类，两者这里都没有成员所有者。局部类依然属于嵌套类，不是顶级类。

### TypeToken 保存的是匿名子类的签名

匿名子类的泛型父类声明可以保留 List<String>，因此可以在构造时读取它。下面是一个只处理直接继承的最小实现；多层泛型继承还需要变量替换规则，不能仅多调用一次 getGenericSuperclass 就保证正确。

```java
package io.allurx;

import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.List;

/**
 * @author allurx
 */
public abstract class TypeToken<T> {

    private final Type runtimeType;

    public TypeToken() {
        Type superclass = getClass().getGenericSuperclass();
        if (!(superclass instanceof ParameterizedType)) {
            throw new IllegalArgumentException(getClass() + "必须是参数化类型");
        }
        runtimeType = ((ParameterizedType) superclass).getActualTypeArguments()[0];
    }

    public final Type getType() {
        return runtimeType;
    }

    public static void main(String[] args) {
        System.out.println(new TypeToken<List<String>>() {}.getType());
    }
}
```

执行 `java -cp out io.allurx.TypeToken`，实测输出 `java.util.List<java.lang.String>`。它利用声明留下的签名，不是从普通 List 对象内部“反向恢复”被擦除的实参。若写成含未解析变量的 TypeToken<List<T>>，得到的仍可能是 T。

## 类型尚未确定时，读取变量与边界

### TypeVariable 的身份还包括声明者

T、O 是类型变量；List<String> 中的 String 是 Class，不是 TypeVariable。变量可以定义在类、方法或构造器上。getBounds 读取上界，未显式声明上界时为 Object；变量声明不能用 super 指定下界。

```java
package io.allurx;

import java.io.Serializable;
import java.lang.reflect.TypeVariable;
import java.util.Arrays;

/**
 * @author allurx
 */
public class TypeVariableTest<T extends Number & Cloneable & Serializable> {


    <O> TypeVariableTest(O o) {

    }

    private static <T> void test(T t) {

    }


    public static void main(String[] args) throws Exception {
        // 获取类上声明的类型变量
        print(TypeVariableTest.class.getTypeParameters()[0]);

        // 获取构造器定义的类型变量
        print(TypeVariableTest.class.getDeclaredConstructors()[0].getTypeParameters()[0]);

        // 获取方法定义的类型变量
        print(TypeVariableTest.class.getDeclaredMethod("test", Object.class).getTypeParameters()[0]);

    }

    private static void print(TypeVariable typeVariable) {
        System.out.println(typeVariable.getGenericDeclaration()
                + "["
                + typeVariable.getName()
                + ","
                + Arrays.toString(typeVariable.getBounds())
                + "]"
        );
    }

}
```

执行 `java -cp out io.allurx.TypeVariableTest`：

```text
class io.allurx.TypeVariableTest[T,[class java.lang.Number, interface java.lang.Cloneable, interface java.io.Serializable]]
io.allurx.TypeVariableTest(java.lang.Object)[O,[class java.lang.Object]]
private static void io.allurx.TypeVariableTest.test(java.lang.Object)[T,[class java.lang.Object]]
```

同名变量不一定是同一个变量：类上的 T 与方法上的 T 有不同的 GenericDeclaration。解析继承关系时，变量映射应同时考虑声明者，不能只用名称字符串当键。

[![类、方法和构造器的泛型声明关系](./images/generic-declaration.png)](./images/generic-declaration.png)

### WildcardType 表示实参范围，而不是一个确定类型

读到 `List<? extends Number>` 时，我们知道元素类型受 `Number` 约束，却没有得到某个唯一元素类。`WildcardType` 保留的正是这种范围：`? extends Number` 有 `Number` 上界、没有下界；`? super Number` 有 `Number` 下界，上界则是 `Object`。无下界时返回空数组。

```java
package io.allurx;

import java.lang.reflect.ParameterizedType;
import java.lang.reflect.WildcardType;
import java.util.Arrays;
import java.util.List;

/**
 * @author allurx
 */
public class WildcardTypeTest<T> {

    public List<? extends Number> list1;

    public List<? super Number> list2;

    public List<? extends T> list3;

    public static void main(String[] args) throws Exception {
        ParameterizedType list1 = (ParameterizedType) WildcardTypeTest.class.getField("list1").getGenericType();
        ParameterizedType list2 = (ParameterizedType) WildcardTypeTest.class.getField("list2").getGenericType();
        ParameterizedType list3 = (ParameterizedType) WildcardTypeTest.class.getField("list3").getGenericType();
        print((WildcardType) list1.getActualTypeArguments()[0]);
        print((WildcardType) list2.getActualTypeArguments()[0]);
        print((WildcardType) list3.getActualTypeArguments()[0]);
    }

    private static void print(WildcardType wildcardType) {
        System.out.println("UpperBounds："
                + Arrays.toString(wildcardType.getUpperBounds())
                + ","
                + "LowerBounds："
                + Arrays.toString(wildcardType.getLowerBounds()));
    }
}
```

执行 `java -cp out io.allurx.WildcardTypeTest`：

```text
UpperBounds：[class java.lang.Number],LowerBounds：[]
UpperBounds：[class java.lang.Object],LowerBounds：[class java.lang.Number]
UpperBounds：[T],LowerBounds：[]
```

第三个字段的上界仍是 T，说明边界也需要递归解析。获取边界只是读取声明，不会自动证明某个运行时对象满足业务需要的类型约束。

## 泛型数组需要保留维度并继续解析组件

String[] 可以由数组 Class 表达；T[]、List<String>[] 的组件保留泛型结构。多维数组还会递归：T[][] 的组件 T[] 本身就是 GenericArrayType，不能只允许组件为变量或参数化类型。

```java
package io.allurx;

import java.lang.reflect.GenericArrayType;
import java.util.List;

/**
 * @author allurx
 */
public class GenericArrayTypeTest<T> {

    public T[] array1;

    public T[][] array2;

    public List<String>[] array3;

    public List<?>[] array4;

    public static void main(String[] args) throws Exception {
        GenericArrayType array1 = (GenericArrayType) GenericArrayTypeTest.class.getDeclaredField("array1").getGenericType();
        GenericArrayType array2 = (GenericArrayType) GenericArrayTypeTest.class.getDeclaredField("array2").getGenericType();
        GenericArrayType array3 = (GenericArrayType) GenericArrayTypeTest.class.getDeclaredField("array3").getGenericType();
        GenericArrayType array4 = (GenericArrayType) GenericArrayTypeTest.class.getDeclaredField("array4").getGenericType();
        print(array1);
        print(array2);
        print(array3);
        print(array4);
    }

    private static void print(GenericArrayType genericArrayType) {
        System.out.println(genericArrayType.getGenericComponentType().getClass());
    }
}
```

执行 `java -cp out io.allurx.GenericArrayTypeTest`：

```text
class sun.reflect.generics.reflectiveObjects.TypeVariableImpl
class sun.reflect.generics.reflectiveObjects.GenericArrayTypeImpl
class sun.reflect.generics.reflectiveObjects.ParameterizedTypeImpl
class sun.reflect.generics.reflectiveObjects.ParameterizedTypeImpl
```

这里打印具体类名只是帮助观察当前 JDK 的表示。业务代码应该分别使用 TypeVariable、GenericArrayType、ParameterizedType 等公开接口，避免升级 JDK 后依赖内部类路径。

## 解析真实声明时的边界

假设一个基类声明字段 `T value`，子类继承它时指定 `T` 为 `String`。字段本身的声明仍然是 `T`；要得出当前子类中应使用 `String`，解析器还需沿继承关系建立变量替换。只读出类型结构和结合使用上下文解析类型，是相邻但不同的两步。

递归展开也可能再次遇到自身，例如 `T extends Comparable<T>`。解析器需要记录正在处理的声明，避免沿边界无限循环；参数化成员类型还可能从 owner 继承变量，数组则必须保留维度。

如果目标只是识别某个已知字段类型，不必预先实现通用类型解析框架；先按所需结构处理，并为不支持的类型给出清楚结果。需要类型使用注解时，继续使用 [AnnotatedType](/annotated-type/) 读取平行的注解结构。

## 资料来源

- [Type 的公开接口](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Type.html)
- [ParameterizedType：实参、原始类型和所有者](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/ParameterizedType.html)
- [TypeVariable：声明者和边界](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/TypeVariable.html)
- [WildcardType：通配符上下界](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/WildcardType.html)
- [GenericArrayType：数组组件类型](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/GenericArrayType.html)
