---
title: "JDK 动态代理"
date: 2019-12-17
updated: 2026-10-03
tags:
  - Java
  - 代理
  - Jdk动态代理
domain: Java
---

调用 `person.eat()` 时，希望先执行一次准备动作，又希望 `Alex` 只保留吃饭本身的逻辑。可以在调用者与 `Alex` 之间放一个同样实现 `Person` 的对象：调用者仍然调用 `eat()`，这个对象先做准备，再把调用交给 `Alex`。

这个中间对象就是代理。静态代理需要自己写出实现类；JDK 动态代理根据接口在运行时生成实现类，把每次调用交给 `InvocationHandler`。下面用同一个例子比较两条调用路径，再看生成出来的对象有哪些需要特别处理的行为。

完整用法示例只依赖标准库，目标环境为 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）。底层生成过程以 [OpenJDK 8u202-b08 Proxy](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/reflect/Proxy.java) 为准；内部生成器、代理类名称和保存 class 文件的参数随 JDK 实现变化。

## 同一份接口，两种代理方式

### 接口与目标定义业务行为

Person 声明 eat，Alex 实现实际工作。增强行为如果只属于 Alex 自身业务，直接写入实现可能更简单；需要跨多个实现共享、独立组合或替换时，代理才有明确价值。

```java
package io.allurx;

/**
 * @author allurx
 */
public interface Person {

    /**
     * 吃饭
     */
    void eat();
}
```

```java
package io.allurx;

/**
 * @author allurx
 */
public class Alex implements Person {

    @Override
    public void eat() {
        System.out.println("Alex开始吃饭");
    }
}
```

### 静态代理：实现接口，显式转交

```java
package io.allurx;

/**
 * @author allurx
 */
public class PersonProxy implements Person {

    private Person person;

    public PersonProxy(Person person) {
        this.person = person;
    }

    @Override
    public void eat() {
        System.out.println("吃饭前先洗个手");
        person.eat();
    }
}
```

调用方仍面向 Person，代理在调用目标前打印洗手信息。代价是每个接口都需要维护相应转发方法；多个接口需要相同的通用拦截行为时，动态代理可以复用调用处理器。

### 动态代理：把转交过程集中到处理器

```java
package io.allurx;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * @author allurx
 */
public class PersonInvocationHandler implements InvocationHandler {

    private Person person;

    public PersonInvocationHandler(Person person) {
        this.person = person;
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        System.out.println("吃饭前先洗个手");
        try {
            return method.invoke(person, args);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
```

invoke 的 proxy 是生成的代理对象，method 描述被调用的方法，args 是实参数组；无参数调用的 args 可能为 null。这里把 method.invoke 的目标设为 person，而不是 proxy，否则会再次进入代理形成递归。

反射调用把目标异常包装为 InvocationTargetException，处理器解包后传播原始 cause，避免改变异常身份。代理返回值还必须满足接口签名：基本类型返回值不能被随意替换成 null，不兼容类型会在调用端失败。

## 编译运行两种代理

五段代码分别保存为 Person.java、Alex.java、PersonProxy.java、PersonInvocationHandler.java、DemoApplication.java：

```java
package io.allurx;

import java.lang.reflect.Proxy;

/**
 * @author allurx
 */
public class DemoApplication {
    public static void main(String[] args) {
        Person target = new Alex();
        new PersonProxy(target).eat();
        Person dynamic = (Person) Proxy.newProxyInstance(
                Person.class.getClassLoader(), new Class<?>[]{Person.class},
                new PersonInvocationHandler(target));
        dynamic.eat();
    }
}
```

```shell
javac -encoding UTF-8 -d out Person.java Alex.java PersonProxy.java PersonInvocationHandler.java DemoApplication.java
java -cp out io.allurx.DemoApplication
```

两种代理各输出一次“吃饭前先洗个手”和“Alex开始吃饭”。示例只验证 eat 的调用链，不把这种简单转交当作通用代理的全部语义。

## 调用处理器还要遵守对象和接口契约

### Object 方法也会进入处理器

`equals`、`hashCode`、`toString` 也会进入 `InvocationHandler`。本例在每次调用前都打印洗手信息，所以连 `dynamic.toString()` 都会触发它。这说明示例的增强范围比业务方法更大；实现通用拦截逻辑时，需要按方法决定是否执行增强。

相等关系更值得单独考虑。若目标沿用 `Object.equals`，把 `dynamic.equals(dynamic)` 原样转交成 `target.equals(dynamic)` 会得到 `false`，连自反性都被破坏。代理应明确采用对象身份、目标身份还是业务标识，并一致地实现 `equals` 与 `hashCode`。

### 异常要与接口声明相容

处理器抛出接口未声明的受检异常时，代理可能包装为 UndeclaredThrowableException；运行时异常和 Error 则按代理契约传播。异常策略应与接口一致，不应静默吞掉失败。

## Java 8 如何生成和实例化代理

在所引 Java 8 版本中，Proxy 验证接口列表和类加载器，利用缓存查找或生成代理类。ProxyClassFactory 调用 ProxyGenerator 产生字节码，再定义 Class；生成类继承 Proxy 并实现传入接口，构造器接收 InvocationHandler。

生成方法的核心效果相当于把 this、对应 Method 和实参数组交给处理器。应用通过 Proxy.newProxyInstance 使用这条路径，无需导入 sun.misc.ProxyGenerator 或调用 defineClass0。

若要对照这一版本的生成字节码，可以在 Java 8 启动参数中设置 `-Dsun.misc.ProxyGenerator.saveGeneratedFiles=true`，然后用 `javap` 检查生成文件。这个参数属于 Java 8 的具体实现；上面的 Java 25 用法示例只依赖公开的 `Proxy.newProxyInstance`，无需启用它。

## 适用范围

JDK 动态代理生成的是接口实现，不能直接把一个没有接口的具体类变成其子类代理。自调用如果发生在目标对象内部，也不会因为外部有代理就自动再次进入处理器。需要不同连接点或类结构增强时，应区分代理与 [AspectJ 字节码织入](/aspectj/) 的能力边界。

## 资料来源

- [Proxy：接口、类加载器与代理方法契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Proxy.html)
- [InvocationHandler：参数、返回值与异常](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/InvocationHandler.html)
- [OpenJDK 8u202-b08 Proxy](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/reflect/Proxy.java)
- [OpenJDK 8u202-b08 ProxyGenerator](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/sun/misc/ProxyGenerator.java)
