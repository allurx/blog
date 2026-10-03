---
title: "Import 注解"
date: 2019-07-03
updated: 2026-10-03
tags:
  - Spring
  - Spring-Annotation
domain: Spring
---

`@Import` 把普通组件、配置类和自定义注册逻辑接入 Spring 的配置处理过程。固定组合可以直接导入类；需要根据注解元数据选择导入项时使用 `ImportSelector`；需要自行定义 Bean 名称、类型或构造参数时使用 `ImportBeanDefinitionRegistrar`。选哪种形式，取决于谁来决定注册内容。

本文用 Spring Framework **7.0.9** 的独立容器演示这些入口，不依赖 Spring Boot 或组件扫描。完整示例在 **Windows 11 x64、Oracle JDK 25.0.2 LTS、Apache Maven 3.10.0** 下执行，输出与下文一致；依赖与插件版本保存在 [pom.xml](./pom.xml)。7.0.x 是当前稳定的 Framework 分支；Maven 采用稳定版，不把预览版当作 LTS。[Framework 文档与版本](https://docs.spring.io/spring-framework/reference/)、[Maven 下载与版本说明](https://maven.apache.org/download.cgi)

## 先运行一个不受组件扫描干扰的例子

下载 [完整 Java 示例](./ImportDemo.java)，按下面的目录放置文件：

```text
spring-import-demo/
├─ pom.xml
└─ src/main/java/io/allurx/ImportDemo.java
```

在项目根目录执行：

```sh
java -version
mvn -version
mvn compile exec:java
```

观察五行应用输出，Maven 的构建日志不属于示例结果：

```text
direct=allurx
configuration=allurx
selected: speak=true, sing=false
alternative: speak=false, sing=true
registered=allurx
```

每组示例都创建并关闭自己的 `AnnotationConfigApplicationContext`，只传入当前要演示的配置类。这样，某个 Bean 是否出现取决于明确的导入链，不会因为组件扫描发现了旁边的类而掩盖 `@Import` 的作用。下面按这些输出追踪注册过程。

## 直接导入普通类：把类型交给容器管理

`@Import` 的核心声明是一个类数组：

```java
public @interface Import {
    Class<?>[] value();
}
```

它不仅接受 `@Configuration` 类，也接受普通组件类，以及后文的选择器、注册器。完整声明的注解目标和元数据语义见 [`Import` API](https://docs.spring.io/spring-framework/docs/7.0.9/javadoc-api/org/springframework/context/annotation/Import.html)。

第一个配置直接导入 `Person`：

```java
@Configuration(proxyBeanMethods = false)
@Import(Person.class)
public static class DirectConfig {
}
```

`Person` 没有 `@Component`，也没有被扫描；容器处理 `DirectConfig` 时从 `@Import` 取得它的类型并注册 Bean 定义。容器刷新后，`getBean(Person.class)` 才能取得实例。这里按类型查询，不依赖框架生成的默认 Bean 名。

## 导入配置类：把一组 Bean 组合进来

如果一个能力由多个 `@Bean` 方法组成，可以把它们放在独立配置类，再显式导入：

```java
@Configuration(proxyBeanMethods = false)
public static class PersonConfig {
    @Bean
    public Person person() {
        return new Person();
    }
}

@Configuration(proxyBeanMethods = false)
@Import(PersonConfig.class)
public static class ComposedConfig {
}
```

处理 `ComposedConfig` 时，Spring 继续解析 `PersonConfig`，由 `person()` 的定义创建名为 `person` 的 Bean。`proxyBeanMethods = false` 适合这里互不调用的工厂方法；如果一个 `@Bean` 方法直接调用另一个方法，需要另外理解代理模式与普通 Java 调用的差异。

在启用了组件扫描的应用中，同一个配置类可能同时被扫描发现，因此删除 `@Import` 后仍能运行。那只能说明还有另一条注册路径，不能证明导入配置类没有作用。本文用独立容器排除了这条路径。

## ImportSelector：根据导入方的元数据选择类型

当类型组合取决于注解参数时，先定义一个表达能力选择的注解：

```java
@Retention(RUNTIME)
@Target(TYPE)
@Import(PersonSelector.class)
public @interface EnableAbilities {
    boolean speak() default false;
    boolean sing() default false;
}
```

`PersonSelector` 实现 `ImportSelector`，读取导入方的 `AnnotationMetadata`，根据 `speak` 和 `sing` 返回对应类型的**全限定类名**。返回值不是 Bean 名，也不是已经创建的对象。核心选择逻辑如下，完整导入和元数据检查见附件：

```java
List<String> imports = new ArrayList<>();
if (attributes.getBoolean("speak")) {
    imports.add(SpeakAbility.class.getName());
}
if (attributes.getBoolean("sing")) {
    imports.add(SingAbility.class.getName());
}
return imports.toArray(String[]::new);
```

示例里的 `SpeakingConfig` 使用 `@EnableAbilities(speak = true)`，容器只有 `SpeakAbility`；另一个容器的 `SingingConfig` 使用 `sing = true`，得到相反结果。把两个参数都设为 `true` 会导入两种能力，都保持默认值则两种都不导入。

这个选择发生在配置解析阶段。容器已经刷新后，再改变某个普通业务字段不会自动重新执行选择器；它也不是每次调用方法时动态注入对象的机制。[`ImportSelector` API](https://docs.spring.io/spring-framework/docs/7.0.9/javadoc-api/org/springframework/context/annotation/ImportSelector.html)

## ImportBeanDefinitionRegistrar：直接提交 Bean 定义

选择器只返回类型名。当注册过程还需要控制 Bean 名称、构造参数或其他定义属性时，可以实现注册器：

```java
public static class PersonRegistrar implements ImportBeanDefinitionRegistrar {
    @Override
    public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata,
            BeanDefinitionRegistry registry) {
        registry.registerBeanDefinition("person", new RootBeanDefinition(Person.class));
    }
}
```

`RegisteredConfig` 通过 `@Import(PersonRegistrar.class)` 接入它。注册器提交的是 `RootBeanDefinition`，此时不需要手工 `new Person()`；实例的创建和生命周期仍由容器负责。运行后按名称和类型调用 `getBean("person", Person.class)`，得到最后一行输出。[`ImportBeanDefinitionRegistrar` API](https://docs.spring.io/spring-framework/docs/7.0.9/javadoc-api/org/springframework/context/annotation/ImportBeanDefinitionRegistrar.html)

示例中的名称 `person` 在其独立容器里唯一。放入真实项目时，应先确定命名责任与重复定义策略，不能默认同名注册一定覆盖原 Bean，也不应随意修改已有定义。

## 按实际注册责任选择入口

| 需要决定的内容 | 合适入口 |
| --- | --- |
| 固定导入一个普通组件或一组配置 | `@Import` 直接列类型 |
| 根据导入方元数据选择哪些类参与配置 | `ImportSelector` |
| 自行控制 Bean 名称及定义属性 | `ImportBeanDefinitionRegistrar` |

三种入口都参与容器配置，不是三套独立的依赖注入系统。能直接导入时，无需为了形式完整增加选择器或注册器；需要条件组合或定义级控制时，再使用相应扩展点。组合配置的其他形式见 [Spring Java 配置组合指南](https://docs.spring.io/spring-framework/reference/core/beans/java/composing-configuration-classes.html)。
