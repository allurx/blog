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

同一个应用里，API 请求可能使用一种认证方式，浏览器页面使用另一种。每条安全链都描述自己的匹配范围和过滤器，但 Servlet 容器需要的是一个统一的入口。

`WebSecurity` 在启动时收集这些链的构建器，把它们组合成 `FilterChainProxy`。本文沿这个构建过程解释：配置器何时参与、`HttpSecurity` 何时加入，以及 `ignoring()` 为什么会改变请求最终选中的链。

本文研究 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的构建过程。应先理解 Java 泛型和构建器的基本用途；运行示例及 JDK 配套条件见 [Spring Security 基本概念](/spring-security-basics/)。构建器行为以所链接的固定版本源码为准。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 三个相近名字分别指什么

| 名称 | 在该版本中的含义 |
| --- | --- |
| `SecurityFilterChain` | 一条安全链的接口，包含请求匹配与过滤器列表 |
| `FilterChainProxy` | 从多条安全链中选择第一条匹配链，并执行它的 Servlet Filter |
| `springSecurityFilterChain` | Spring 容器中的 Bean 名，通常对应 FilterChainProxy；启用安全调试时外面还会包装 DebugFilter |

WebSecurity 构建最后一行所需的对象；HttpSecurity 构建第一行的单条链。二者共享构建器基类，不能据此认为返回类型相同。

[![Spring Security 5.1.5 中 WebSecurity 的接口与构建器继承关系](./images/web-security.png)](./images/web-security.png)

## 从 Bean 工厂到配置器生命周期

生成过滤入口需要先执行配置，再生成最终对象。这两步分别落在构建器的公共基类和具体实现中。

### build 只进入一次 doBuild

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

### init 准备共享对象，configure 使用它们

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

## 把单条安全链组合为过滤入口

生命周期确定以后，再回到 WebSecurity 特有的工作：先收集构建器，再按顺序生成链。

### 适配器登记 HttpSecurity

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

### performBuild 保留各条链的顺序

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

### ignoring 与 permitAll 为什么会得到不同处理

假设 `/assets/**` 命中了前面的忽略链，请求会选中一个没有安全过滤器的列表，后面的链就没有机会处理它。若改为在普通链内对 `/assets/**` 配置 `permitAll()`，请求仍会经过该链配置的上下文、安全响应头、CSRF 等处理，只是在授权判断时允许访问。

因此，要保留哪些安全处理应由资源需求决定；“无需登录”本身并不意味着“无需经过安全过滤器”。

## 用结果类型连接启动与请求阶段

定位配置问题时，先确认 HttpSecurity 生成的匹配器和过滤器是否正确，再确认 WebSecurity 中各条链的顺序，最后进入 [FilterChainProxy](/filter-chain-proxy/) 看请求实际命中了哪条链。容器里存在 `springSecurityFilterChain` Bean，只能说明有过滤入口，不能独自证明每条 URL 都受到预期保护。
