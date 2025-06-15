---
title: Aop概述
date: 2019-12-22
categories:
- Java
- Aop概述
tags:
- Java
- Aop概述
---

# 概述

AOP是Aspect Oriented Program的首字母缩写，翻译成中文为面向切面编程。java是面向对象（OOP）的编程语言，面向对象的特点是继承、封装和多态。而封装就要求将功能分散到不同的对象中去，这在软件设计中往往称为职责分配。实际上也就是说，让不同的类设计不同的方法。这样代码就分散到一个个的类中去了。这样做的好处是降低了代码的复杂程度，使类可重用。但是随着业务越来越复杂会发现程序中很多类都存在重复的代码，例如每个类中都会存在那种打印方法的入参、结果、耗时这种日志代码。这时比较聪明的工程师就会编写一个日志工具类然后在需要打印日志的方法中调用该工具类，或者是编写一个打印日志父类让需要打印日志的类继承该类，但是由于java只允许单继承，如果这个类需要扩展新功能就会变得很棘手。纵观上面两种方法无论是编写工具类还是继承父类就会将业务类与其耦合在一起，随着业务越来越复杂最终业务类就很有可能变得很难维护。那有没有一种方式能够动态的给类添加功能呢？答案是肯定的，**这种在运行时，动态地将代码切入到类的指定方法、指定位置上的编程思想就是面向切面的编程。** 我们可以将那些额外功能的代码编写成一个切面，等需要时再切入到对象之中。由此看来AOP其实是对OOP的一个补充，OOP将一个功能分割成多个对象，而AOP则提供切面为这些对象提供额外的功能。并且从技术角度来看aop基本上都是基于代理模式来实现的，也就是在运行时基于原始对象的特性选择jdk动态代理（生成目标对象实现接口的实现类）、cglib（基于asm库生成目标对象的子类）等方式来动态给对象添加功能。

<!-- more -->

# AspectJ

AspectJ是一个基于Java语言的AOP框架，包括编译器（`ajc`），调试器（`ajdb`），文档生成器（`ajdoc`），程序结构浏览器（`ajbrowser`）。AspectJ使用特定的编译器用来生成遵守Java字节编码规范的Class文件，达到给对象添加额外功能的目的。

## 术语

### Join Points
连接点是程序执行中定义明确的点。AspectJ中定义的连接点：

1. Method call（方法调用）

   方法被调用时，不包括非静态方法的超级调用。也就是如果父类的某个方法被子类通过super的方式调用则不会被拦截，但是子类直接通过this.父类方法调用则会被拦截。

2. Method execution（方法执行）

   实际方法的代码体被执行时。不管方法以哪种形式被执行了都会被拦截。

3. Constructor call（构造函数调用）

   对象被构建时。也就是如果是子类通过super或者构造器内部通过this调用的则不会被拦截。直接通过new调用的才会被拦截。注意即便是通过反射调用的也不会被拦截。
   
4. Constructor execution（构造函数执行）

   实际的构造函数的代码体被执行时，不管方法以哪种形式被执行了都会被拦截。正在构造的对象是当前正在执行的对象，因此可以使用`this`切入点进行访问。构造函数执行连接点未返回任何值，因此其返回类型被视为无效。

5. Static initializer execution（静态初始化程序执行）

   类中的静态块初始化。由于没有返回任何值，因此其返回类型被视为无效。

6. Object pre-initialization（对象预初始化）

   在运行特定类的对象初始化代码之前。这包括从其第一个被调用的构造函数开始到其父级的构造	函数开始之间的时间。因此，这些连接点的执行包含`this（）`和 `super（）`构造函数调 用的参数求值的连接点。对象预初始化连接点没有返回任何值，因此其返回类型被认为是无效的。
   
7. Object initialization（对象初始化）
   
   当特定类的对象初始化代码运行时。这包括返回其父级的构造函数与返回其第一个被调用的构造函数之间的时间。它包括用于创建对象的所有动态初始化器和构造函数。正在构造的对象是当前正在执行的对象，因此可以使用`this`切入点进行访问 。
   
8. Field reference（域引用）

   当引用非常量字段时。注意：对常量字段的引用（绑定到常量字符串对象或原始值的静态最终字段）不是连接点。

9. Field set（域被设置值时）

   字段被值关联时（字段被设置值的时候）。由于字段被设置值时没有返回任何值，因此其返回类型被认为是无效的。请注意：常量字段（静态最终字段，其中初始值设定项是常量字符串对象或原始值）的初始化不是连接点。

10. Handler execution（异常被catch时）

    当异常被捕获时。处理程序执行连接点被视为具有一个参数，正在处理异常。该连接点没有返回任何值，因此其返回类型被认为是无效的。

11. Advice execution（advice被执行时）

    当Advice中的代码体执行时。

每个Join Points都可能具有与之关联的三种状态：当前正在执行的对象，目标对象和参数的对象数组。这些分别由`this`， `target`和`args`这三个状态暴露切入点。下表反映了不同的Join Points与之关联的切入点。

  <table border="1">
   <colgroup>
    <col />
    <col />
    <col />
    <col />
   </colgroup>
   <thead valign="top">
    <tr>
     <th><span class="bold"><b>Join Point</b></span></th>
     <th><span class="bold"><b>Current Object</b></span></th>
     <th><span class="bold"><b>Target Object</b></span></th>
     <th><span class="bold"><b>Arguments</b></span></th>
    </tr>
   </thead>
   <tbody>
    <tr>
     <td>Method Call</td>
     <td>executing object</td>
     <td>target object</td>
     <td>method arguments</td>
    </tr>
    <tr>
     <td>Method Execution</td>
     <td>executing object</td>
     <td>executing object</td>
     <td>method arguments</td>
    </tr>
    <tr>
     <td>Constructor Call</td>
     <td>executing object</td>
     <td>None</td>
     <td>constructor arguments</td>
    </tr>
    <tr>
     <td>Constructor Execution</td>
     <td>executing object</td>
     <td>executing object</td>
     <td>constructor arguments</td>
    </tr>
    <tr>
     <td>Static initializer execution</td>
     <td>None</td>
     <td>None</td>
     <td>None</td>
    </tr>
    <tr>
     <td>Object pre-initialization</td>
     <td>None</td>
     <td>None</td>
     <td>constructor arguments</td>
    </tr>
    <tr>
     <td>Object initialization</td>
     <td>executing object</td>
     <td>executing object</td>
     <td>constructor arguments</td>
    </tr>
    <tr>
     <td>Field reference</td>
     <td>executing object</td>
     <td>target object</td>
     <td>None</td>
    </tr>
    <tr>
     <td>Field assignment</td>
     <td>executing object</td>
     <td>target object</td>
     <td>assigned value</td>
    </tr>
    <tr>
     <td>Handler execution</td>
     <td>executing object</td>
     <td>executing object</td>
     <td>caught exception</td>
    </tr>
    <tr>
     <td>Advice execution</td>
     <td>executing aspect</td>
     <td>executing aspect</td>
     <td>advice arguments</td>
    </tr>
   </tbody>
  </table>

### Pointcuts

切入点是一个更加具体的程序运行时明确的元素，它是Join Point的一种更加具体的表现，例如`Method Call`的一个切入点为`call(public void say())`（一个public修饰的名为say的无返回值且无参数的方法被调用时）。也就是说在运行时这个方法将会被拦截。AspectJ中定义原始切入点有以下几种：

1. call(MethodPattern)

   选择签名与MethodPattern匹配的每个方法调用连接点 。

2. execution(MethodPattern)

   选择签名与MethodPattern匹配的每个方法执行连接点 。

3. get(FieldPattern)

   选择签名与FieldPattern匹配的每个字段引用连接点 。注意：对常量字段的引用（绑定到常量字符串对象或原始值的静态最终字段）不是连接点。

4. set(FieldPattern)

   选择签名与FieldPattern匹配的每个字段被设置值连接点 。注意：常量字段（静态最终字段，其中初始值设定项是常量字符串对象或原始值）的初始化不是连接点。

5. call(ConstructorPattern)

   选择签名与ConstructorPattern匹配的每个构造函数调用连接点 。

6. execution(ConstructorPattern)

   选择签名与ConstructorPattern匹配的每个构造函数执行连接点 。

7. initialization(ConstructorPattern)

   选择签名与ConstructorPattern匹配的每个对象初始化连接点 。

8. preinitialization(ConstructorPattern)

   选择签名与ConstructorPattern匹配的每个对象预初始化连接点 。

9. staticinitialization(TypePattern)

   选择签名与TypePattern匹配的每个静态初始化程序执行连接点 。

10. handler(TypePattern)

    选择签名与TypePattern匹配的每个异常处理程序连接点 。即拦截catch语句

11. adviceexecution()

    选择所有建议执行连接点。

12. within(TypePattern)

    挑选出每个执行类型为TypePattern匹配的连接点。

13. withincode(MethodPattern)

    在签名与MethodPattern匹配的方法中，选择定义执行代码的每个连接点 。

14. withincode(ConstructorPattern)

    在签名与ConstructorPattern匹配的构造函数中，选择在其中定义执行代码的每个连接点 。

15. cflow(Pointcut)

    选取Pointcut选取的任何连接点P的控制流中的每个连接点 ，包括P本身。

16. cflowbelow(Pointcut)

    选取Pointcut选取的任何连接点P的控制流中的每个连接点 ，但不包括P本身。

17. this(Type or Id)

    选择当前执行对象（绑定`this`对象）是Type实例或标识符Id类型（必须在封闭建议或切入点定义中进行绑定）的实例的每个连接点。不匹配来自静态上下文的任何连接点。

18. target(Type or Id)

    选取目标对象（应用了调用或域操作的对象）是Type实例或标识符Id类型 （必须在封闭建议或切入点定义中绑定）的实例的每个连接点 。不匹配任何调用，获取或静态成员集。

19. args（Type or Id，...）

    选择每个连接点，其中参数是适当类型的实例（如果使用该表单，则为标识符的类型）。如果参数的静态类型（声明的参数类型或字段类型）与指定的args类型相同或为其子类型，则匹配`null`参数。

20. PointcutId(TypePattern or Id, ...)

    选择由PointcutId命名的用户定义的切入点指示符选择的每个连接点 。

21. if(BooleanExpression)

    选择布尔表达式的计算结果为`true`的每个连接点。使用的布尔表达式只能访问静态成员，封闭的切入点或`advice`暴露的参数以及`thisJoinPoint`形式。特别是，它不能在切面上调用非静态方法，也不能使用返回值或`after advice`暴露的异常。

22. ! Pointcut

    选择与Pointcut未匹配的连接点 。

23. Pointcut0 && Pointcut1

    选择同时匹配Pointcut0和Pointcut1的连接点 。

24. Pointcut0 || Pointcut1

    选择匹配Pointcut0和Pointcut1中任意一个的连接点 。

25. (Pointcut)

    选择匹配Pointcut匹配的每个连接点 。

#### 切点语法匹配汇总

```java
MethodPattern = 
  [ModifiersPattern] TypePattern 
        [TypePattern . ] IdPattern (TypePattern | ".." , ... ) 
        [ throws ThrowsPattern ]
ConstructorPattern = 
  [ModifiersPattern ] 
        [TypePattern . ] new (TypePattern | ".." , ...) 
        [ throws ThrowsPattern ]
FieldPattern = 
  [ModifiersPattern] TypePattern [TypePattern . ] IdPattern
ThrowsPattern = 
  [ ! ] TypePattern , ...
TypePattern = 
    IdPattern [ + ] [ [] ... ]
    | ! TypePattern
    | TypePattern && TypePattern
    | TypePattern || TypePattern
    | ( TypePattern )  
IdPattern =
  Sequence of characters, possibly with special * and .. wildcards
ModifiersPattern =
  [ ! ] JavaModifier  ...
```

- MethodPattern代表的是方法匹配模式
- ConstructorPattern代表的是构造器匹配模式
- FieldPattern代表的是域匹配模式
- ThrowsPattern代表的是throws语句匹配模式
- TypePattern代表的是类型匹配模式
- IdPattern代表的是一个具体的字符序列或者带有特定通配符的表达式
- ModifiersPattern代表的是任意java中的修饰符
- []代表的是可选的
- *代表0至任意字符
- ..发在方法参数中代表任意数量的参数，放在包名后代表当前包及其子包
- +放在类名后代表当前类及其子类，放在接口后代表当前接口及其实现类

### Advice

Advice代表的是在Pointcuts匹配时的**某个阶段**需要执行的代码，通俗的讲就是我们给切面类写的增强的功能代码需要在目标方法执行前还是执行后或者是其它**某个阶段**执行。同时每个Advice的定义都遵循以下格式：

```java
[ strictfp ] AdviceSpec [ throws TypeList ] : Pointcut { Body }
```

* []中的内容是非必填的

* 被strictfp修饰的方法在执行浮点运算表达式时会完全依照浮点规范IEEE-754

* AdviceSpec为以下其中之一

  - `before( Formals )`：前置通知
  - `after( Formals ) returning [ ( Formal ) ]`后置通知，finally语句中
  - `after( Formals ) throwing [ ( Formal ) ]`抛出异常时通知
  - `after( Formals )`后置通知，return语句前
  - `Type around( Formals )`在方法执行前后通知，可以控制方法是否执行。

  其中Formal类似于方法的参数的名称，比如`String s`，其中s代表的就是Formal，而Formals则相当于以逗号分割的参数列表。

* throws TypeList代表的是该advice可能抛出的异常，这些异常必须与该Advice的每个匹配的切入点兼容，即Advice申明上如果throws的是CheckedException，则与该Advice匹配的每个方法的签名都必须throws该CheckedException或者该CheckedException的父类异常。当然了抛出的运行时异常是不受限制的，这和java异常申明的语法是保持一致的。

* Pointcut { Body }代表的切入点，可能是已定义的Pointcuts或者是直接定义的切入点表达式

### Static crosscutting

Advice在运行时动态的改变了切入类的行为，但是不能修改切入类的类型结构。但是通过静态横切，AspectJ能够改变切入类（甚至是其它切面）的数据结构，即能够给切入类新增变量或者方法。

### Aspect

Aspect是AspectJ添加到Java中的一种与java类类似的新语言元素。它由pointcuts与Advice组成，我们可以基于Aspect来针对程序中某个关注点进行横切和加强。通俗的讲就是由Advice组成的一个增强功能，比如在每个方法执行前打印参数，**匹配方法的规则就是Pointcuts**，**在匹配到的方法中执行前编写打印参数的代码就是Advice**，**不同的Advice就组成了不同的Aspect**。

#### Aspect定义

Aspect定义与java类的定义和很相似，java用`class`关键字申明一个类，AspectJ使用`aspcet`关键字申明一个Aspect，当然Aspect与java类也有很多不同之处：

* 除了常规的方法和字段定义之外，Aspect还可以申明Advice，pointcuts和inter-type这几种特殊的元素。
* Aspect不能通过new关键字、克隆、序列化这几种方式实例化。并且只能定义一个无参构造函数
* 嵌套的Aspect必须使用static关键字修饰

#### Aspect继承

* Aspect可以继承类或实现接口
* 类不能继承Aspect
* Aspect可以继承其它抽象的Aspect（使用abstract修饰），在这种情况下不仅继承其它Aspect的字段和方法同时也继承了切入点。注意不能继承非抽象的Aspect。

#### Aspect实例化

由于Aspect不能通过new关键字实例化，因此每个Aspect都提供了一个aspectOf方法来获取该Aspect的实例。

#### 具有特权的Aspect

通常情况下Aspect访问类的成员遵循java的访问规则，但是特殊情况下如果需要访问某个类的私有的成员或者方法等，此时可以使用privileged关键字修饰Aspect即可访问类中的所有成员。


# 使用AspectJ

根据官方推荐的教程，首先我们需要在[AspectJ下载](https://www.eclipse.org/aspectj/downloads.php#stable_release)这个页面中下载最新的jar包，下载到本地之后，使用`java -jar`命令运行该jar包，接着会弹出一个安装界面，一路next就行，安装成功后的页面如下：

![](/images/Java/Aop/Aspectj.png)

上图中有两个建议，第一个是将安装完成后解压的目录中aspectjrt.jar包添加到你工程的类路径下，第二个建议是将加压目录下的bin路径添加到你环境变量的path中。以便手动调用ajc编译器编译java代码。由于我使用的是idea，首先第一步检查idea是否已安装aspectJ语法支持插件

![](/images/Java/Aop/IdeaAspectjPlugin.png)

第二步将AspectJ安装后解压目录下的aspectjrt.jar添加到工程库中（快捷键ctrl+shift+alt+s）

![](/images/Java/Aop/IdeaAspectjrt.png)

第三步切换idea中java编译器为ajc编译器

![](/images/Java/Aop/Ajc.png)

完成以上三步之后接下来我们就可以使用aspectj了。

# 例子

首先我们先编写一个HelloWorld类，在其中定义一些方法和域

```java
package com.zyc;

/**
 * @author zyc
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

HelloWorld类很简单，只包含一个私有的静态域以及几个公共的方法，接下来我们编写aspect来对HelloWorld各个维度进行横切。忘记AspectJ语法的可以回到上面重新回顾一下。

```java
package com.zyc;

/**
 * 通过privileged修饰的aspect可以访问类的所有成员，即便是private的成员
 *
 * @author zyc
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

HelloWorldAspect切面已经编写好了，接下来我们调用HelloWorld类中的main方法，看一下控制台的输出是否和预期的一致：

```java
I'm a private field on HelloWorld
before
Hello World
after
I'm a new method on HelloWorld
I'm a new field on HelloWorld
发生了NPE！！！
Exception in thread "main" java.lang.NullPointerException
	at com.zyc.HelloWorldAspect.ajc$before$com_zyc_HelloWorldAspect$3$4be2f9fb(HelloWorldAspect.aj:40)
	at com.zyc.HelloWorld.main(HelloWorld.java:16)
```

可以看到HelloWorldAspect分别从以下几个方面对HelloWorld进行了横切：

1. 在HelloWorld构造函数被执行时访问了其私有的域
2. 在say方法调用前打印信息
3. 在say方法调用后打印信息
4. 给HelloWorld类添加新的方法
5. 给HelloWorld类添加新的域
6. 在NullPointerException异常被catch的时候进行拦截
7. 在saySomething方法调用前检查其参数是否为null，如果为null则抛出NullPointerException

当然AspectJ能做的事情远远不止与这些，上面只是一个很简单的例子，通过这个例子我们现在应该能够更好的理解aop与oop之间的关系，aop对oop进行了极大的增强，对于实现某个功能时，我们可以将这个功能看成一个数据流，使用aop对这个数据流在不同的方面进行横切增强，以便实现对功能更为细致和优雅的控制。

# 参考

[AspectJ编程指南](https://www.eclipse.org/aspectj/doc/released/progguide/index.html)

[AspectJ开发者笔记](https://www.eclipse.org/aspectj/doc/released/adk15notebook/index.html)

[AspectJ常见问题](https://www.eclipse.org/aspectj/doc/released/faq.php)