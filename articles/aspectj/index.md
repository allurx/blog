---
title: "用 AspectJ 理解 AOP：切点、通知与字节码织入"
date: 2019-12-22
updated: 2026-10-03
tags:
  - Java
  - Aop概述
domain: Java
---

一个方法需要在执行前后记录日志，十个方法也需要同样的日志。逐个修改方法体很直接，但日志规则一变，每个位置都要跟着改。AOP 允许把这段共同的行为独立写出来，再用规则指定它在哪些执行位置生效。

AspectJ 把这些规则织入字节码，因此还能处理构造器、字段访问和异常处理器等位置。下面从一个可运行的小程序出发，观察代码里没有显式调用的通知怎样执行，再说明它与 JDK 动态代理的区别。

示例采用 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69）与 AspectJ 1.9.25.1，使用编译时织入。代码中的 `aspect` 和成员引入需要由 AspectJ 编译器处理。

## 先区分选中哪里与执行什么

| 概念 | 职责 |
| --- | --- |
| Join point（连接点） | 程序执行中可被识别的位置，例如调用、执行、字段访问 |
| Pointcut（切点） | 选择一组连接点的表达式或命名规则 |
| Advice（通知） | 在选中连接点的前、后或周围执行的代码 |
| Aspect（切面） | 组织切点、通知及其他切面声明的单元 |

例如 `call(void Person.eat())` 选中调用 `eat` 的位置，`execution(void Person.eat())` 选中 `eat` 的方法体执行。两者都与同一次方法调用有关，却位于不同的字节码中：前者需要处理调用方，后者需要处理方法所在的类。这也解释了为什么切点写对以后，还要检查相应代码是否参与织入。

## 编译并观察一个切面

### 准备编译器与运行库

选用 [AspectJ 1.9.25.1 稳定发布](https://github.com/eclipse-aspectj/aspectj/releases/tag/V1_9_25_1) 和 Java 25 LTS。1.9.25 系列支持 Java 25，编译器最低需要 JDK 17；AspectJ 的版本策略独立于 JDK，不能把它的版本号也称为 JDK LTS。

从 Maven Central 获取 [aspectjtools-1.9.25.1.jar](https://repo.maven.apache.org/maven2/org/aspectj/aspectjtools/1.9.25.1/aspectjtools-1.9.25.1.jar) 与 [aspectjrt-1.9.25.1.jar](https://repo.maven.apache.org/maven2/org/aspectj/aspectjrt/1.9.25.1/aspectjrt-1.9.25.1.jar)，与两个源文件放在同一工作目录。前者提供 ajc 编译器/织入器，后者提供运行库。

### 普通类负责发起调用

HelloWorld 调用普通方法，也访问切面引入的新方法和字段。最后故意向 saySomething 传入 null，用于观察通知阻止原方法执行。

保存为 HelloWorld.java：

```java
package io.allurx;

/**
 * @author allurx
 */
public class HelloWorld {

    private static String privateField = "I'm a private field on HelloWorld";

    public static void main(String[] args) throws Exception {
        HelloWorld helloWorld = new HelloWorld();
        helloWorld.say();
        helloWorld.newMethod();
        System.out.println(helloWorld.newField);
        helloWorld.catchException();
        helloWorld.saySomething(null);
    }

    public void say() {
        System.out.println("Hello World");
    }

    public void saySomething(String s) {
        System.out.println(s);
    }

    public void catchException() {
        try {
            throw new NullPointerException("发生了NPE！！！");
        } catch (NullPointerException e) {
        }
    }
}
```

### 切面声明匹配位置与额外行为

切面把 `say()` 的调用绑定到 `before`、`after` 两段通知，另外演示空参数检查、构造器与异常处理器的连接点。`newField`、`newMethod` 则是成员引入：它们经过编译后成为目标类的成员，不是运行时反射临时查找出来的值。

保存为 HelloWorldAspect.aj：

```java
package io.allurx;

/**
 * 通过privileged修饰的aspect可以访问类的所有成员，即便是private的成员
 *
 * @author allurx
 */
public privileged aspect HelloWorldAspect {

    /**
     * 只能是无参构造函数
     */
    private HelloWorldAspect() {
    }

    /**
     * HelloWorld类中say方法的切入点
     */
    pointcut say(HelloWorld helloWorld):target(helloWorld) && call(void say());

    /**
     * 在say切点匹配的方法执行前（即HelloWorld中的say方法）打印信息
     */
    before(HelloWorld helloWorld):say(helloWorld) {
        System.out.println("before");
    }

    /**
     * 在say切点匹配的方法执行后（即HelloWorld中的say方法）打印信息
     */
    after(HelloWorld helloWorld):say(helloWorld){
        System.out.println("after");
    }

    /**
     * 在saySomething方法执行前判断输入参数是否为null
     */
    before(HelloWorld helloWorld)throws NullPointerException:target(helloWorld) && call(void saySomething(String)){
        if (thisJoinPoint.getArgs()[0] == null) {
            throw new NullPointerException();
        }
    }

    /**
     * 在HelloWorld构造器执行前访问HelloWorld的私有域
     */
    before():execution(HelloWorld.new()){
        System.out.println(HelloWorld.privateField);
    }

    /**
     * 拦截HelloWorld的catchException方法中的catch
     */
    before(NullPointerException e):handler(NullPointerException) && args(e){
        System.out.println(e.getMessage());
    }

    /**
     * 给HelloWorld类添加一个新的成员变量
     */
    public String HelloWorld.newField = "I'm a new field on HelloWorld";

    /**
     * 给HelloWorld类添加一个新的方法
     */
    public void HelloWorld.newMethod() {
        System.out.println("I'm a new method on HelloWorld");
    }

}
```

aspect 是 AspectJ 语法，不能交给普通 javac 单独编译；HelloWorld 还依赖切面引入的成员，所以两个源文件要一起交给 ajc。privileged 允许切面访问目标的私有成员，是这个演示访问 privateField 的前提，不是所有切面必须开启的选项。

### 一起编译，再检查执行顺序

以下命令用于 Windows PowerShell；Linux、macOS 的运行时类路径分隔符改为冒号：

```powershell
java -cp aspectjtools-1.9.25.1.jar org.aspectj.tools.ajc.Main -25 -encoding UTF-8 -classpath aspectjrt-1.9.25.1.jar -d out HelloWorld.java HelloWorldAspect.aj
java -cp "out;aspectjrt-1.9.25.1.jar" io.allurx.HelloWorld
```

本例是编译时织入，不需要 `javaagent`。输出应依次包含私有字段、`before`、`Hello World`、`after`、新方法文本、新字段文本和被捕获的异常信息；最后的 `NullPointerException` 来自切面拒绝空参数，运行退出码为 `1` 是预期结果。

```text
I'm a private field on HelloWorld
before
Hello World
after
I'm a new method on HelloWorld
I'm a new field on HelloWorld
发生了NPE！！！
Exception in thread "main" java.lang.NullPointerException
```

先看中间三行：目标方法只打印了 `Hello World`，两侧的 `before` 和 `after` 来自织入。再看最后一次 `saySomething(null)`：前置通知抛异常后，目标方法没有机会执行，因此不会再打印一行 `null`。通知可以改变控制流，这一点比多打印几行日志更需要在实际使用时留意。

生成的织入方法名和堆栈行号取决于编译结果。如果没有观察到 `before`、`after`，先检查两个源文件是否一起参与编译，以及运行时是否使用刚生成的 class。

## 从示例扩展到其他切点与通知

### 切点表达式选中哪些执行位置

| 表达式 | 关注的范围 |
| --- | --- |
| call / execution | 方法或构造器的调用位置/执行位置 |
| get / set | 非常量字段的读取/写入 |
| within / withincode | 声明类型或词法代码范围 |
| this / target / args | 当前执行对象、目标对象和参数类型或绑定 |
| cflow / cflowbelow | 指定连接点的动态控制流，后者排除起点本身 |
| handler | 异常处理器执行 |
| `&&`、`\|\|`、`!` | 合取、析取和排除 |

this 与 target 在静态上下文不一定存在；call 与 execution 也不总有相同的当前对象。重用表达式时必须检查连接点种类，不能把“同一个方法名”当作上下文完全相同。

类型模式中的 `*` 匹配名称片段，`..` 可表示包层级或参数数量，`+` 表示子类型关系。组合表达式前，可以先问“规则需要控制调用者所在的位置，还是被调用方法的执行”，再选择 `call` 或 `execution`，最后收窄类型和参数范围。完整语法见[官方编程指南](https://eclipse.dev/aspectj/doc/latest/progguide/index.html)。

### 正常返回与异常完成需要不同通知

| 通知 | 何时执行 |
| --- | --- |
| before | 进入选中连接点之前 |
| after returning | 仅正常返回之后 |
| after throwing | 抛出匹配异常之后 |
| 普通 after | 正常或异常完成之后，类似 finally |
| around | 包围或替代连接点，通过 proceed 决定是否继续 |

在 after returning 中改写绑定到局部变量的返回值，不等于修改调用者收到的结果；需要替换结果通常应由 around 返回新值。通知抛出异常也可能改变原调用结果，因此通用日志或统计逻辑不能随意引入新的失败行为。

## 织入与代理的选择边界

AspectJ 可作用于比普通方法代理更广的连接点，但需要构建或类加载链参与。Spring AOP 的代理机制不因此自动获得字段访问、构造器等全部能力；目标内部自调用与外部经过代理的调用也不同。

回到日志的需求：若调用都经过服务接口，代理通常就能覆盖希望记录的方法边界。如果需要观察目标内部调用、构造器执行或字段访问，AspectJ 提供的连接点更合适，同时构建与调试也必须理解织入后的代码。本例中访问新增成员的 Java 源码必须和切面一起编译，就是这种成本最直接的体现。

## 资料来源

- [AspectJ 编程指南](https://eclipse.dev/aspectj/doc/latest/progguide/index.html)
- [Advice 的完成、返回和异常语义](https://eclipse.dev/aspectj/doc/released/progguide/semantics-advice.html)
- [ajc 编译器选项](https://eclipse.dev/aspectj/doc/latest/devguide/ajc.html)
- [AspectJ 与 Java 版本兼容表](https://github.com/eclipse-aspectj/aspectj/blob/master/docs/release/JavaVersionCompatibility.adoc)
- [Spring AOP 的代理边界](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)
