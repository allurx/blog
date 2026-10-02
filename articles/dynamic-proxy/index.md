---
title: "JDK 动态代理"
date: 2019-12-17
updated: 2026-10-02
tags:
  - Java
  - 代理
  - Jdk动态代理
domain: Java
---

JDK 动态代理在运行时生成实现指定接口的代理类，并把代理方法调用交给 `InvocationHandler`。它帮助复用调用前后的增强逻辑，但不能直接代理一个没有接口的具体类；传给处理器的 `proxy` 与被委托的目标对象也承担不同职责。

下面先比较静态代理与 JDK 动态代理，再以 [OpenJDK 8u202-b08](https://github.com/openjdk/jdk8u/blob/jdk8u202-b08/jdk/src/share/classes/java/lang/reflect/Proxy.java) 分析 Proxy 与 InvocationHandler 的协作。ProxyGenerator、defineClass0 和 sun.misc.ProxyGenerator.saveGeneratedFiles 属于这一版本的内部实现；应用通过公开的 Proxy API 创建代理。


## 静态代理

常见的静态代理方式就是我们提前为需要代理的对象写好一个代理类，然后在程序运行前使用代理类来执行目标对象的方法。下面我们通过几个例子来阐述静态代理和动态代理间额区别。

下面定义了一个Person接口，有一个抽象的eat方法需要子类去实现。

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

下面我们定义一个人Alex实现Person接口

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

如果增强逻辑需要由多个 Person 实现共享，或者希望独立组合和替换，就可以使用代理，把增强职责与各实现的业务职责分开。只有单个实现、增强本来就属于其业务时，直接修改实现也可能更简单；是否引入代理取决于实际变化边界。

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

现在我们新加了一个Person代理类，它实现了Person接口以便代理所有Person的实现类，提供一个Person类型参数的构造器以便在代理类初始化时确定当前代理的是哪个Person。然后在eat方法执行前添加洗手的操作。下面我们测试一下这个代理类。

```java
public static void main(String[] args) {
    PersonProxy personProxy = new PersonProxy(new Alex());
    personProxy.eat();
}
```

控制台输出

```java
吃饭前先洗个手
Alex开始吃饭
```

可以看到我们的PersonProxy类对Person的eat方法进行了增强。现在我们思考一下，这样对接口的所有实现类进行代理似乎是一个很不错的做法，但如果系统中有很多接口，而这些接口现在都需要在执行方法前进行增强，例如给这些方法打印执行时间，此时我们就需要为每一个类都写一个代理类，这无疑是很繁琐的事情。静态代理的劣势就体现出来了。那有没有好的方法能够在程序运行期间动态的对这些类进行代理（增强）呢？答案是肯定的，下面我们就介绍基于jdk提供的动态代理的实现。

## jdk动态代理

jdk动态代理是在程序运行期间基于提供的接口动态生成实现该接口的类，然后通过反射获取上一步生成的Class中规定好的`$Proxy0(InvocationHandler invocationHandler )`这个只有一个InvocationHandler 类型参数的构造器，然后在通过这个构造器实例化目标接口的代理类，最终在目标接口的所有方法被调用前通过我们自定义的InvocationHandler来对这些方法进行增强。本质上jdk动态代理和静态代理的理念是一致的，都是对某种类型的对象进行代理，只是jdk提供了动态生成接口实现类的方法，而静态代理则是提前人为编写好了。这里需要注意的是jdk动态代理只能对接口进行代理， 实现上还是略微有点限制的。 下面我们还是基于上面的Person接口，使用jdk动态代理来增强其eat方法。使用jdk动态代理一共需要涉及到两个类，一个是InvocationHandler，这个类是需要我们自己来实现接口以便对需要代理的类在进行方法调用时进行增强，另一个是Proxy类，这个类主要提供了一些静态的方法来生成代理类的Class或者是直接生成代理对象。

### InvocationHandler

现在我们需要对Person接口的所有子类在调用eat方法前进行增强，第一步我们需要实现InvocationHandler接口，该接口只有一个方法

```java
package java.lang.reflect;

public interface InvocationHandler {

    public Object invoke(Object proxy, Method method, Object[] args)
        throws Throwable;
}
```

这个方法的第一个参数proxy是当前的代理对象（即jdk帮我们自动生成的目标接口的代理对象），第二个参数method是被代理接口对象的方法（注意是接口Person的eat方法，不是Alex的eat方法），第三个args是方法调用需要的参数，也就是我们通过代理对象调用方法传递的参数。下面我们定义Person接口的InvocationHandler

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

处理器保存被委托的 Person，对该目标调用 method.invoke 并返回结果；proxy 是代理对象，不能把它当作反射调用目标，否则会再次进入处理器。InvocationTargetException 需要解包，保留目标方法的原始异常。代理的 equals、hashCode、toString 也会进入处理器，通用代理应明确这些方法的语义。

### Proxy

Proxy类提供了一些静态方法，例如生成代理对象的Class或者直接生成代理对象等等。

```java
public class Proxy implements java.io.Serializable {

    // 获取指定代理对象的InvocationHandler
    @CallerSensitive
    public static InvocationHandler getInvocationHandler(Object proxy){
        ...
    }

    // 生成指定接口列表的代理类的Class
    @CallerSensitive
    public static Class<?> getProxyClass(ClassLoader loader,
                                         Class<?>... interfaces){
        ...
    }

    // 判断目标Class是否是生成的代理类
    public static boolean isProxyClass(Class<?> cl) {
        ...
    }

    // 直接生成目标接口的代理对象
    @CallerSensitive
    public static Object newProxyInstance(ClassLoader loader,
                                          Class<?>[] interfaces,
                                          InvocationHandler h){
        ...
    }
}
```

下面我们通过getProxyClass方法来生成我们上面Person接口的代理对象

```java
    public static void main(String[] args) throws Exception{
        Class<?> proxyClass = Proxy.getProxyClass(Thread.currentThread().getContextClassLoader(), Person.class);
        Constructor<?> declaredConstructor = proxyClass.getDeclaredConstructor(InvocationHandler.class);
        Person person = (Person) declaredConstructor.newInstance(new PersonInvocationHandler(new Alex()));
        person.eat();
    }
```

首先第一步调用getProxyClass方法传入当前线程的类加载器以及代理类需要实现的接口列表，这里传入的就是Person接口，然后就能获取到代理类的Class，接着通过反射获取相应的构造器实例化该代理类，然后调用在代理类上调用eat方法，控制台输出：

```java
吃饭前先洗个手
Alex开始吃饭
```

整个代理过程不算很复杂，当然了Proxy还提供了一个直接生成代理对象的方法，省去了我们自己反射构造器构造对象这一步，下面通过newProxyInstance方法生成代理对象与上面我们通过getProxyClass获取代理对象Class反射构造对象是一样的。

```java
    public static void main(String[] args) throws Exception{
        Person person = (Person) Proxy.newProxyInstance(Thread.currentThread().getContextClassLoader()
                , new Class<?>[]{Person.class}
                , new PersonInvocationHandler(new Alex()));
        person.eat();
    }
```

### 原理

jdk动态代理本质上是生成目标接口的代理类的Class对象，然后反射构造器注入InvocationHandler来实现对目标对象增强的。最终代理对象的Class生成是在其内部静态类ProxyClassFactory中实现的，当然前面还有各种缓存操作，我们这里只关注代理类Class生成的过程。

```java
private static final class ProxyClassFactory
    implements BiFunction<ClassLoader, Class<?>[], Class<?>>
{
    // prefix for all proxy class names
    private static final String proxyClassNamePrefix = "$Proxy";

    // next number to use for generation of unique proxy class names
    private static final AtomicLong nextUniqueNumber = new AtomicLong();

    @Override
    public Class<?> apply(ClassLoader loader, Class<?>[] interfaces) {

        ...省略相关代码
            // 关键步骤在这一步生成代理对象的字节码
            byte[] proxyClassFile = ProxyGenerator.generateProxyClass(
            proxyName, interfaces, accessFlags);

        try {
            // 调用native方法生成Class
            return defineClass0(loader, proxyName,
                                proxyClassFile, 0, proxyClassFile.length);
        } catch (ClassFormatError e) {
            throw new IllegalArgumentException(e.toString());
        }
    }
}
```

关键步骤是通过ProxyGenerator.generateProxyClass方法来生成目标接口的代理类的字节码，最后通过内部一个名为defineClass0的native方法生成代理类的Class

```java
private static native Class<?> defineClass0(ClassLoader loader, String name,
                                            byte[] b, int off, int len);
```

纵观Proxy方法内部其实生成代理对象的逻辑很简单，就是通过ProxyGenerator.generateProxyClass生成代理对象的字节码然后通过native方法生成Class对象。但是默认情况下我们工程的target目录是看不到这个生成的代理类的class文件的，点进去ProxyGenerator.generateProxyClass方法看一下方法逻辑

```java
 public static byte[] generateProxyClass(final String var0, Class<?>[] var1, int var2) {
        ProxyGenerator var3 = new ProxyGenerator(var0, var1, var2);
        final byte[] var4 = var3.generateClassFile();
        // 这一步有一个判断是否生成class文件
        if (saveGeneratedFiles) {
            ...省略
        }
        return var4;
    }
```

原来在生成字节码的过程中会判断是否需要生成class文件，而判断的条件是

```java
private static final boolean saveGeneratedFiles = (Boolean)AccessController.doPrivileged(new GetBooleanAction("sun.misc.ProxyGenerator.saveGeneratedFiles"));
```

如果系统参数中sun.misc.ProxyGenerator.saveGeneratedFiles为true则会生成class文件，那接下来我们将这个参数设置为true

```java
    public static void main(String[] args) throws Exception{
        System.getProperties().put("sun.misc.ProxyGenerator.saveGeneratedFiles","true");
        Person person = (Person) Proxy.newProxyInstance(Thread.currentThread().getContextClassLoader()
                , new Class<?>[]{Person.class}
                , new PersonInvocationHandler(new Alex()));
        person.eat();
    }
```

执行完上述代码发现在我们的src同级目录下多出来了一个目录，里面存放的就是生成的代理类的class，我们将它反编译一下看看

```java
package com.sun.proxy;

import io.allurx.Person;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.lang.reflect.UndeclaredThrowableException;

public final class $Proxy0 extends Proxy implements Person {
    private static Method m1;
    private static Method m3;
    private static Method m2;
    private static Method m0;

    public $Proxy0(InvocationHandler var1) throws  {
        super(var1);
    }

    public final boolean equals(Object var1) throws  {
        try {
            return (Boolean)super.h.invoke(this, m1, new Object[]{var1});
        } catch (RuntimeException | Error var3) {
            throw var3;
        } catch (Throwable var4) {
            throw new UndeclaredThrowableException(var4);
        }
    }

    public final void eat() throws  {
        try {
            super.h.invoke(this, m3, (Object[])null);
        } catch (RuntimeException | Error var2) {
            throw var2;
        } catch (Throwable var3) {
            throw new UndeclaredThrowableException(var3);
        }
    }

    public final String toString() throws  {
        try {
            return (String)super.h.invoke(this, m2, (Object[])null);
        } catch (RuntimeException | Error var2) {
            throw var2;
        } catch (Throwable var3) {
            throw new UndeclaredThrowableException(var3);
        }
    }

    public final int hashCode() throws  {
        try {
            return (Integer)super.h.invoke(this, m0, (Object[])null);
        } catch (RuntimeException | Error var2) {
            throw var2;
        } catch (Throwable var3) {
            throw new UndeclaredThrowableException(var3);
        }
    }

    static {
        try {
            m1 = Class.forName("java.lang.Object").getMethod("equals", Class.forName("java.lang.Object"));
            m3 = Class.forName("io.allurx.Person").getMethod("eat");
            m2 = Class.forName("java.lang.Object").getMethod("toString");
            m0 = Class.forName("java.lang.Object").getMethod("hashCode");
        } catch (NoSuchMethodException var2) {
            throw new NoSuchMethodError(var2.getMessage());
        } catch (ClassNotFoundException var3) {
            throw new NoClassDefFoundError(var3.getMessage());
        }
    }
}
```

原来生成的代理类是上面这个样子，实现了我们传入的接口Person，继承了Proxy，只有一个参数类型为InvocationHandler的构造器，执行eat方法时其实调用的就是我们自己编写的InvocationHandler，将当前代理类this，接口Person的eat方法以及相关的方法参数传递给InvocationHandler，现在联系一下我们之前写的PersonInvocationHandler以及通过Proxy.newProxyInstance方法生成代理对象，是不是恍然大悟了呢？其实这个代理类会实现所有传入的接口，在所有接口方法调用前使用我们定义的InvocationHandler进行加强。

## 总结

jdk动态代理是基于java反射实现的，并且只能为接口生成代理类。具体步骤如下：

1. 通过ProxyGenerator.generateProxyClass方法生成指定接口代理类的字节码，然后在通过native方法defineClass0生成代理类的Class对象。
2. 通过反射拿到这个代理类Class中的构造器，最终再调用这个构造器传入我们编写的InvocationHandler实例化代理类。

## 资料来源

- [Proxy：动态代理类的公共契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Proxy.html)
- [InvocationHandler：代理方法调用](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/InvocationHandler.html)
