---
title: "沿一次登录理解 Spring Security 的配置与过滤链"
date: 2019-07-04
updated: 2026-10-03
tags: [Spring, Spring-Security, 安全架构]
domain: Spring
---

浏览器请求一个受保护的页面，被带到登录页；提交正确密码后，又回到了原来的页面。这段看起来很短的交互，背后有几件不同的工作：判断哪个请求需要登录、校验凭据、记住认证结果，以及决定当前用户能否访问目标。

读 Spring Security 源码时，很容易把负责这些工作的对象与配置它们的对象混在一起。本文沿一次表单登录串起它们的关系，再回到应用启动阶段解释这些对象怎样产生。分析基线为 **Spring Boot 2.1.5.RELEASE、Spring Security 5.1.5.RELEASE 的 Servlet 应用**；下文的适配器和授权 API 均以这一版本为准。

## 请求到达后，过滤链怎样处理它

先假设 `/reports` 要求用户登录，并具有相应权限。这里描述调用顺序，具体 URL 规则由应用配置；可以用[基本概念中的最小工程](/spring-security-basics/)观察默认登录流程。

### 未登录时，先保存目标再要求认证

Servlet 容器通过代理进入名为 `springSecurityFilterChain` 的 Bean，它通常是一个 `FilterChainProxy`。后者按顺序寻找第一条匹配的 `SecurityFilterChain`，再执行其中的过滤器。

这条链会准备 `SecurityContext`，尝试取得已有认证信息，并在下游检查访问规则。若访问 `/reports` 需要登录，而请求尚未提供足够的身份信息，异常转换组件可以保存原请求，再让认证入口把浏览器重定向到登录页。浏览器这时还没有执行报表业务。

这里有两个容易混淆的“匹配”：先选中整条安全链，再在链内匹配资源的授权规则。前一条链已经匹配时，请求不会继续尝试后一条链。[FilterChainProxy 的选择过程](/filter-chain-proxy/)

### 提交表单时，由认证管理器检查凭据

默认的 `POST /login` 由 `UsernamePasswordAuthenticationFilter` 读取表单字段。它把用户名、密码装入认证请求，再交给 `AuthenticationManager`。通常参与这一过程的 `ProviderManager` 会寻找能够处理该令牌类型的认证提供者。

过滤器关心 HTTP 输入和后续响应，提供者关心凭据是否有效。例如 DAO 提供者取得用户资料后，使用密码编码器校验提交的密码。认证成功返回的是一个包含主体和权限的 `Authentication`。它能让后续组件继续判断当前身份可以做什么。[表单过滤器](/username-password-filter/)与[认证管理器](/authentication-manager/)分别展开这两段调用。

成功处理会把认证结果放入安全上下文，并由成功处理器决定响应。默认表单流程可以跳转回先前保存的目标；跨请求恢复身份则由上下文仓库和相应过滤器完成。

### 返回目标后，还要检查权限

再次访问 `/reports` 时，即使已经识别出用户，也仍需判断其权限是否满足规则。在本文版本中，`HttpSecurity.authorizeRequests()` 配置的请求授权通常由 `FilterSecurityInterceptor` 执行。用户登录成功但没有报表权限，依然会被拒绝。

方法授权提供另一个检查位置：使用 `@EnableGlobalMethodSecurity` 启用后，方法拦截器可以在调用服务方法时检查权限。请求授权围绕 HTTP 请求，方法授权围绕方法调用；表达式则是一种编写规则的方式，两层都可以使用。

## 启动时，配置怎样变成过滤链

前面出现的是已经建好的运行对象。应用启动时，构建器负责把配置转换成这些对象，配置器则告诉构建器要加入什么规则。

### HttpSecurity 构建一条链，WebSecurity 组合多条链

| 构建对象 | 输入的主要内容 | 最终产物 |
| --- | --- | --- |
| `HttpSecurity` | 链的匹配范围、登录方式、会话与授权规则等 | 一条 `SecurityFilterChain` |
| `WebSecurity` | 单条链构建器及整体 Web 配置 | 通常为 `FilterChainProxy` 的过滤入口 |

例如，一个应用可以为 `/api/**` 建一条链，为浏览器页面建另一条链。每个 `HttpSecurity` 描述一条链的内容，`WebSecurity` 把它们按既定顺序组合。请求到达后，`FilterChainProxy` 才从成品中选择匹配项。

某个 URL 没走预期登录方式，可能是选错了整条链；已经选对链但权限判定错误，才继续检查链内规则。[WebSecurity 的构建过程](/web-security/)

### 配置器把具体职责交给构建器

`SecurityBuilder` 是构建能力的接口，`SecurityConfigurer` 描述如何配置它。`HttpSecurity` 使用的配置器包括授权、异常转换、匿名认证等；它们在初始化与配置阶段准备共享对象、创建过滤器并接入链中。

在本文版本里，应用常通过 `WebSecurityConfigurerAdapter` 覆盖不同的 `configure` 方法。参数为 `AuthenticationManagerBuilder` 时配置认证能力，参数为 `HttpSecurity` 时配置单条 HTTP 链，参数为 `WebSecurity` 时配置整体 Web 入口。这些方法同名，但操作的对象和职责不同。[适配器的三个配置入口](/web-security-configurer/)

想确认一个构建器最终生成什么，查看其 `performBuild()` 比仅凭类名判断更直接。完整启动调用可对照 [WebSecurityConfiguration 5.1.5](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/web/configuration/WebSecurityConfiguration.java)。

## 带着请求结果回看配置

排查一次访问时，可以从最接近现象的位置往前追：请求选中了哪条链，链中的认证过滤器是否处理了它，认证结果包含什么权限，最终哪条规则允许或拒绝了访问。若生成的链本身就不符合预期，再回到启动配置查构建器和配置器。

这样读源码时，每个类都有一个具体问题与之对应。`AuthenticationManager` 解释凭据如何被验证，`FilterSecurityInterceptor` 解释权限如何被检查，`HttpSecurity` 和 `WebSecurity` 则解释这套处理过程如何被装配出来。

## 资料来源

- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
