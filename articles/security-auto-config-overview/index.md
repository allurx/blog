---
title: "Spring Security 自动配置类概述"
date: 2019-06-16
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

一个只有 Web 接口的应用加入 Security starter 后，请求开始要求登录，启动日志里也出现了默认密码。这些现象看起来像“一份安全配置”的结果，实际由几项独立工作共同完成：创建安全过滤器链、准备认证用户，再把过滤入口接到 Servlet 容器。

分开看这些职责，才能解释为什么自定义用户后默认密码消失了，安全过滤器却仍然工作；也能避免排查某个自动配置时，把其他配置的结果一并归到它身上。

本文以 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的 Servlet 实现为准。Boot 2.1.5 通过 `META-INF/spring.factories` 中的 `EnableAutoConfiguration` 条目发现自动配置；Reactive Web 应用使用另一组配置。运行入口见[基本概念](/spring-security-basics/)。

## 在启动时决定哪些配置参与工作

### 发现候选配置后，还要逐项判断条件

该版本安全相关清单包含 SecurityAutoConfiguration、SecurityRequestMatcherProviderAutoConfiguration、UserDetailsServiceAutoConfiguration、SecurityFilterAutoConfiguration，以及 ReactiveSecurityAutoConfiguration 和 ReactiveUserDetailsServiceAutoConfiguration。出现在清单里只表示候选配置，是否生效还需要判断类路径、应用类型和已有 Bean。

例如，一个存在 Security 依赖的非 Web 应用不因此变成 Servlet 应用；应用提供 UserDetailsService 后，也不应再按“默认用户自动生成”推断运行状态。[Boot 2.1.5 的 spring.factories](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/resources/META-INF/spring.factories)

### 四项 Servlet 自动配置分别产出什么

| 自动配置 | 输入条件或依赖 | 主要结果 |
| --- | --- | --- |
| SecurityAutoConfiguration | 类路径具备认证事件发布相关类型 | 接入安全属性、默认事件发布器与后续 Web 配置 |
| SecurityRequestMatcherProviderAutoConfiguration | Servlet 应用；分别满足 MVC 或 Jersey 的类与 Bean 条件 | 提供 RequestMatcherProvider |
| UserDetailsServiceAutoConfiguration | 认证基础已存在，且缺少指定的自定义认证组件 | 按额外条件创建默认内存用户 |
| SecurityFilterAutoConfiguration | Servlet 应用，已有名为 springSecurityFilterChain 的 Bean | 创建注册对象，把 DelegatingFilterProxy 接到 Servlet 容器 |

这里不是要求请求按表格从上到下经过四个类。自动配置在启动时准备对象，请求运行时经过的是已注册的代理与过滤器链。

## 把默认登录页的来源逐层接起来

### 配置器与构建器生成安全过滤入口

SecurityAutoConfiguration 导入 SpringBootWebSecurityConfiguration、WebSecurityEnablerConfiguration 等配置。在未定义安全适配器的 Servlet 场景中，前者补 DefaultConfigurerAdapter，后者按条件启用 @EnableWebSecurity。

Security 自身的 WebSecurityConfiguration 随后收集配置器，用 WebSecurity 构建过滤入口；AuthenticationConfiguration 则准备认证管理器的构建依赖。展开这条链见 [SecurityAutoConfiguration 分析](/security-auto-configuration/)。

### 请求匹配方式随 Web 栈确定

MVC 分支要求 DispatcherServlet 和 HandlerMappingIntrospector；Jersey 分支要求 ResourceConfig、JerseyApplicationPath，并排除 DispatcherServlet。它们提供匹配能力，不执行凭据校验，也不作最终访问决策。

所以仅凭项目依赖中出现某个 Web 库不能决定最终分支，仍要看完整条件与 Bean 是否存在。[匹配器适配配置](/security-request-matchers/)

### 自定义认证组件会改变默认用户的创建

默认内存用户配置要求没有 AuthenticationManager、AuthenticationProvider、UserDetailsService 这些指定类型的 Bean；工厂方法还会检查 OAuth2 ClientRegistrationRepository。用户名、密码和角色从 SecurityProperties 读取。

这使开发应用可以起步，也使应用定义自己的认证能力时能够接管。但“没有随机密码日志”不等于“用户服务已经按预期工作”，日志生成和 Bean 条件必须分开观察。[默认用户配置详解](/default-user-details-service/)

### Servlet 代理把请求送进已经建好的入口

SecurityFilterAutoConfiguration 不重新构建链。它创建 DelegatingFilterProxyRegistrationBean，指定目标 Bean 名 `springSecurityFilterChain`，并设置过滤器顺序与 dispatcher types。Servlet 容器调用代理，代理再委托 Spring 管理的过滤入口。[代理注册分析](/security-filter-registration/)

## 用启动结果验证自己的判断

例如应用新增一个 `UserDetailsService` Bean 后，应先确认默认用户配置的缺失 Bean 条件是否不再成立，再观察安全链是否仍正常创建和注册。这个改变只接管认证数据来源，不必然撤掉请求过滤。

换用另一种 Web 栈或增加自定义适配器时也一样：先确定改变了哪组条件，再检查对应 Bean 和真实请求路径。启动装配告诉我们“对象怎样出现”，请求执行告诉我们“这些对象怎样工作”，两部分证据需要接起来。

固定版本的依赖关系可对照 [Boot 2.1.5 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)。只有把启动装配与请求执行分开，后续的过滤器分析才有明确入口。
