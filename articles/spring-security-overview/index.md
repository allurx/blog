---
title: "Spring Security 总结"
date: 2019-07-04
updated: 2026-10-02
tags:
  - Spring
  - Spring-Security
  - Spring-Security总结
domain: Spring
---

FilterChainProxy 选择安全过滤器链，链上的认证过滤器取得凭据并委托 AuthenticationManager，授权组件检查受保护操作。配置阶段由 SecurityConfigurer 配置 SecurityBuilder，HttpSecurity 构建单条链，WebSecurity 将多条链组合成 FilterChainProxy；配置过程与请求处理过程需要分开理解。

下面把 Servlet 请求处理与启动配置连接起来，说明 `authorizeRequests`、`FilterSecurityInterceptor`、`@EnableGlobalMethodSecurity` 和适配器分别参与哪一层。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/web/configuration/WebSecurityConfiguration.java)。

## 概述

理解 Spring Security，需要把两条流程分开：启动阶段构建安全规则与过滤器链，请求阶段按这些规则认证和授权。下面分别说明两条流程，再连接构建器与配置器的职责。


## 认证

spring-security通过一个名称为**springSecurityFilterChain**的过滤器来保护我们的web安全的，这个过滤器的实际类型是**FilterChainProxy**，在这个过滤器中包含多个**SecurityFilterChain**，然后每一个**SecurityFilterChain**又包含多个**Filter**，当请求来临时，只会匹配第一个**SecurityFilterChain**，这个**SecurityFilterChain**会将这个请求挨个经过内部维护的**Filter**，我们的认证过滤器就包含在其中，最终完成认证。

## 授权

授权可以发生在 HTTP 请求层或方法调用层。请求授权通过 HttpSecurity.authorizeRequests() 配置，由 FilterSecurityInterceptor 根据路径匹配与配置属性做出访问决定。方法授权通过 @EnableGlobalMethodSecurity 启用相应机制，由方法拦截器处理。表达式是规则的表达方式，两层都可以使用，不能把“表达式授权”和“方法注解授权”当成互斥分类。

## SecurityBuilder和SecurityConfigurer

1. **SecurityConfigurer**是用来给**SecurityBuilder**配置属性的，例如**HttpSecurity**的**SecurityConfigurer**有**ExpressionUrlAuthorizationConfigurer**、**ExceptionHandlingConfigurer**、**AnonymousConfigurer**等，而**WebSecurity**的**SecurityConfigurer**则是我们经常编写的继承**WebSecurityConfigurerAdapter**的类。
2. **SecurityBuilder**是用来构建安全对象的，例如**HttpSecurity**最终构建出来的是**SecurityFilterChain**，而**WebSecurity**则将多个**SecurityFilterChain**构建成一个**FilterChainProxy**
3. 要想知道某个**SecurityBuilder**最终构建的什么，查看对应的**performBuild**方法就明白了

## 总结

下面的示例工程可以配合源码阅读；运行时以工程 POM 中的依赖版本为准。

[**spring-security-demo**](https://github.com/allurx/spring-security-demo)

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
