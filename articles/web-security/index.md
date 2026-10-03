---
title: "WebSecurity 源码分析"
date: 2019-06-28
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

Spring Security 的启动配置和请求过滤属于两个阶段。WebSecurity 的职责在启动阶段：收集单条安全链的构建器，执行配置生命周期，再把各条链组合成一个供 Servlet 代理调用的过滤入口。

本文研究 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的历史构建过程。应先理解 Java 泛型和构建器的基本用途；运行示例及 JDK 配套条件见 [Spring Security 基本概念](/spring-security-basics/)。当前框架的配置入口已经演进，本文以固定版本源码为准。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 三个相近名字分别指什么

| 名称 | 在该版本中的含义 |
| --- | --- |
| `SecurityFilterChain` | 一条安全链的接口，包含请求匹配与过滤器列表 |
| `FilterChainProxy` | 从多条安全链中选择第一条匹配链，并执行它的 Servlet Filter |
| `springSecurityFilterChain` | Spring 容器中的 Bean 名，通常对应 FilterChainProxy；启用安全调试时外面还会包装 DebugFilter |

WebSecurity 构建最后一行所需的对象；HttpSecurity 构建第一行的单条链。二者共享构建器基类，不能据此认为返回类型相同。

[![Spring Security 5.1.5 中 WebSecurity 的接口与构建器继承关系](./images/web-security.png)](./images/web-security.png)

## 从 Bean 工厂进入一次性构建

WebSecurityConfiguration 的工厂方法最终调用 `webSecurity.build()`。如果没有任何应用配置器，它会先加入默认适配器；通常 Boot 已经准备了 DefaultConfigurerAdapter。[WebSecurityConfiguration 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/web/configuration/WebSecurityConfiguration.java)

真正的 `build()` 定义在 AbstractSecurityBuilder：

```java
public final O build() throws Exception {
    if (this.building.compareAndSet(false, true)) {
        this.object = doBuild();
        return this.object;
    }
    throw new AlreadyBuiltException("This object has already been built");
}
```

AtomicBoolean 保证同一个构建器只进入一次 `doBuild()`。它不代表任何方法都可并发使用，也不提供失败后的重试：即使构建抛异常，标记仍然已经改变，再次 build 会抛 AlreadyBuiltException。[AbstractSecurityBuilder 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/AbstractSecurityBuilder.java)

## 配置器在什么时候修改构建器

SecurityBuilder 的目标是生成对象；SecurityConfigurer 把某一方面的规则放到构建器中。HttpSecurity 上的 CSRF、会话或授权配置器分别处理自己的职责，应用的 WebSecurityConfigurerAdapter 则把 HttpSecurity 接入 WebSecurity。

AbstractConfiguredSecurityBuilder 把整个过程分为以下阶段：

```java
protected final O doBuild() throws Exception {
    synchronized (configurers) {
        buildState = BuildState.INITIALIZING;

        beforeInit();
        init();

        buildState = BuildState.CONFIGURING;

        beforeConfigure();
        configure();

        buildState = BuildState.BUILDING;

        O result = performBuild();

        buildState = BuildState.BUILT;

        return result;
    }
}
```

| 调用 | 为什么需要这个阶段 |
| --- | --- |
| `beforeInit()` | 子类在初始化配置器前准备自己的状态 |
| `init()` | 调用已应用配置器的 init，建立共享对象与必要的构建器关系 |
| `beforeConfigure()` | 子类在配置阶段前作准备 |
| `configure()` | 让各配置器使用已建立的共享对象配置构建内容 |
| `performBuild()` | 由具体构建器生成最后的对象 |

在初始化期间加入的配置器另有列表，稍后也会执行 init。从进入 `CONFIGURING` 状态起，也就是调用 `beforeConfigure()` 之前，add 就不再接受新配置器；并非等 configure 全部结束才禁止添加。[AbstractConfiguredSecurityBuilder 完整实现](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/AbstractConfiguredSecurityBuilder.java)

### apply 只替换相同具体类型的配置器

基类按配置器的具体 Class 保存列表。默认 `allowConfigurersOfSameType=false` 时，加入相同具体类会替换该键对应的旧列表，其他类型不受影响；为 true 时，则可以在同一类下面保留多个实例。它不是“整个构建器只能有一个 Configurer”。

共享对象另按 Class 存在一张 Map 中，配置器通过 `setSharedObject/getSharedObject` 协作。配置器集合与共享对象集合承担不同职责，不应仅因都按类型索引就混为一谈。

## HttpSecurity 在 init 阶段加入

WebSecurityConfigurerAdapter 的 init 先取得 HttpSecurity，再调用：

```java
web.addSecurityFilterChainBuilder(http).postBuildAction(new Runnable() {
    public void run() {
        FilterSecurityInterceptor securityInterceptor = http
            .getSharedObject(FilterSecurityInterceptor.class);
        web.securityInterceptor(securityInterceptor);
    }
});
```

这段代码将单条链的构建器加入列表，并安排构建后取得相关授权组件。它尚未处理任何 HTTP 请求，也没有在这里直接执行认证。[WebSecurityConfigurerAdapter 的初始化](/web-security-configurer/)

## performBuild 把链组合成 FilterChainProxy

WebSecurity 首先为 `ignoring()` 收集的每个 RequestMatcher 创建一条**空过滤器链**，再调用其他构建器的 build，最后把整个列表交给 FilterChainProxy。忽略链排在前面，匹配它的请求不会进入后面的安全过滤器链。

```java
for (RequestMatcher ignoredRequest : ignoredRequests) {
    securityFilterChains.add(new DefaultSecurityFilterChain(ignoredRequest));
}
for (SecurityBuilder<? extends SecurityFilterChain> securityFilterChainBuilder
        : securityFilterChainBuilders) {
    securityFilterChains.add(securityFilterChainBuilder.build());
}
FilterChainProxy filterChainProxy = new FilterChainProxy(securityFilterChains);
```

随后配置可选 HttpFirewall、调用代理的初始化检查，并在启用调试时包装 DebugFilter。最后执行 postBuildAction，返回过滤入口。[WebSecurity 5.1.5 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/web/builders/WebSecurity.java)

因此，`ignoring()` 与某条链内的 `permitAll()` 不是等价写法：前者匹配空链，后者仍可经过上下文、安全响应头、CSRF 等已配置过滤器，只是在授权规则处允许访问。是否应该跳过这些职责，需要按资源性质判断。

## 用结果类型连接启动与请求阶段

定位配置问题时，先确认 HttpSecurity 生成的匹配器和过滤器是否正确，再确认 WebSecurity 中各条链的顺序，最后进入 [FilterChainProxy](/filter-chain-proxy/) 看请求实际命中了哪条链。容器里存在 `springSecurityFilterChain` Bean，只能说明有过滤入口，不能独自证明每条 URL 都受到预期保护。
