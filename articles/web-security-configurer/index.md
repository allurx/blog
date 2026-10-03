---
title: "WebSecurityConfigurerAdapter 源码分析"
date: 2019-06-29
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

继承 `WebSecurityConfigurerAdapter` 后，会看到三个同名的 `configure` 方法。一个接收 `HttpSecurity`，一个接收 `WebSecurity`，还有一个接收 `AuthenticationManagerBuilder`。把代码写进不同的方法，会改变完全不同的部分。

下面从这三个入口出发，沿 `init()` 和 `getHttp()` 追踪适配器如何准备认证能力，再把单条 HTTP 安全链交给整体构建器。

本文以 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的适配器 API 为分析范围，配置方式与调用顺序均限定于这一版本。运行基线见[基本概念](/spring-security-basics/)，固定实现见 [WebSecurityConfigurerAdapter 5.1.5](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/web/configuration/WebSecurityConfigurerAdapter.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 三个 configure 方法配置不同对象

| 方法 | 主要职责 |
| --- | --- |
| configure(AuthenticationManagerBuilder) | 配置本适配器使用的认证能力 |
| configure(HttpSecurity) | 配置单条 HTTP 安全链的请求规则与登录方式 |
| configure(WebSecurity) | 配置整体 Web 构建器，例如忽略范围 |

它们只是同名重载，不能因为都叫 configure 就推断执行阶段和作用相同。HttpSecurity 的构建结果是单条 SecurityFilterChain，WebSecurity 则组合这些链为 FilterChainProxy。

## 一份适配器配置怎样进入过滤链

即使应用没有覆盖任何方法，适配器也能提供一组默认规则。先看它从哪里来，再看启动时如何使用这些规则。

### Boot 提供默认适配器

缺少自定义适配器且满足 Servlet 条件时，SpringBootWebSecurityConfiguration 提供 DefaultConfigurerAdapter。它继承父类默认行为，不需要覆盖方法就能得到要求认证、表单登录与 HTTP Basic 等起步配置。

应用提供自己的适配器 Bean 后，Boot 的默认适配器退让；但 Security 的其他装配职责并不因此全部消失。[默认适配器配置源码](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SpringBootWebSecurityConfiguration.java)

### init 登记单条链的构建器

`init()` 先取得 HttpSecurity，再把它加入 WebSecurity。下面登记的 `postBuildAction` 留到构建完成后执行，所以此刻还没有可供请求使用的成品链。

```java
public void init(final WebSecurity web) throws Exception {
    final HttpSecurity http = getHttp();
    web.addSecurityFilterChainBuilder(http).postBuildAction(new Runnable() {
        public void run() {
            FilterSecurityInterceptor securityInterceptor = http
                    .getSharedObject(FilterSecurityInterceptor.class);
            web.securityInterceptor(securityInterceptor);
        }
    });
}
```

getHttp 取得本适配器的单条链构建器；addSecurityFilterChainBuilder 把它加入整体构建计划。postBuildAction 在链已生成后取得 FilterSecurityInterceptor，供整体 Web 权限查询等协作使用。整个过程发生在启动构建阶段，没有在此执行某个用户请求。

### getHttp 先准备认证能力，再应用 HTTP 规则

首次调用 getHttp 时，适配器依次完成：

1. 准备认证事件发布器，取得本地或全局 AuthenticationManager。
2. 把它作为 HTTP 链认证构建器的父管理器，建立 UserDetailsService、ApplicationContext、内容协商与信任解析器等共享对象。
3. 创建 HttpSecurity，按 disableDefaults 决定是否安装基础配置器。
4. 调用应用可覆盖的 configure(HttpSecurity)，保存并复用这个构建器。

无参构造器传入 `false`，即**启用默认基础配置**。启用时，基础配置包括 CSRF、上下文、会话、异常转换、请求缓存、匿名支持、Servlet API 集成、默认登录页和退出处理等，随后还会加载 spring.factories 中的 AbstractHttpConfigurer。

默认 configure(HttpSecurity) 再添加具体访问规则和认证方式：

```java
protected void configure(HttpSecurity http) throws Exception {
    logger.debug("Using default configure(HttpSecurity). If subclassed this will potentially override subclass configure(HttpSecurity).");

    http
        .authorizeRequests()
            .anyRequest().authenticated()
            .and()
        .formLogin().and()
        .httpBasic();
}
```

因此，禁用基础默认项与覆盖 configure(HttpSecurity) 是不同操作。显式禁用默认项需要理解缺少哪些职责，不能只为了得到更短的过滤器列表而使用。

## 认证管理器从哪里来

适配器可以使用自己配置的认证管理器，也可以使用全局配置的结果。这一选择由下面的标记控制。

### 本地配置与全局配置如何选择

父类默认的 configure(AuthenticationManagerBuilder) 只设置 disableLocalConfigureAuthenticationBldr 标记，表示本地未提供认证配置，随后改从全局 AuthenticationConfiguration 取得管理器。子类覆盖并配置传入的 auth 时，通常不会调用这个默认实现，便由本地 builder 构建。

```java
protected AuthenticationManager authenticationManager() throws Exception {
    if (!authenticationManagerInitialized) {
        configure(localConfigureAuthenticationBldr);
        if (disableLocalConfigureAuthenticationBldr) {
            authenticationManager = authenticationConfiguration
                    .getAuthenticationManager();
        }
        else {
            authenticationManager = localConfigureAuthenticationBldr.build();
        }
        authenticationManagerInitialized = true;
    }
    return authenticationManager;
}
```

这个分支也解释了为什么重写方法后又调用 super 可能改变预期：super 的作用是设置切换标记，不是自动合并一套默认用户配置。最终以标记与 builder 状态为准，不能反过来说“重写方法就不使用传入的 builder”。

### 需要其他 Bean 使用时，显式暴露对象

authenticationManagerBean 和 userDetailsServiceBean 提供把相应结果暴露为 Bean 的入口，该版本通常由子类覆盖并添加 @Bean。适配器内部持有的 HttpSecurity、认证 builder 等字段，并不因为被创建就自动成为独立容器 Bean。

默认密码编码器还会延迟查找应用提供的 PasswordEncoder，没有时使用 DelegatingPasswordEncoder；它的存储格式见[认证管理器分析](/authentication-manager/)。

## 按配置层次定位行为变化

要改用户如何认证，追踪 AuthenticationManagerBuilder 和提供者；要改 URL 的要求和登录响应，追踪 HttpSecurity；要改多条链、忽略范围和最终代理，追踪 WebSecurity。再到实际请求里观察匹配链与过滤器，才能确认配置变化确实到达预期层次。[单条链构建](/http-security/)、[整体 Web 构建](/web-security/)
