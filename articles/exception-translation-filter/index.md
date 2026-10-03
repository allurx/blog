---
title: "ExceptionTranslationFilter 源码分析"
date: 2019-06-13
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

认证或授权失败最终需要变成浏览器能理解的响应。ExceptionTranslationFilter 负责把下游传播回来的安全异常交给合适的入口或拒绝处理器；它不验证密码，也不参与权限投票。

本文分析 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的 Servlet 过滤链。前置知识是 AuthenticationException、AccessDeniedException 和[匿名身份](/anonymous-authentication/)。固定实现见 [ExceptionTranslationFilter 5.1.5](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/access/ExceptionTranslationFilter.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 为什么过滤器位置会影响异常能否被处理

它把下游 `chain.doFilter(request, response)` 放进 try，再检查传播回来的异常原因链。只有从这个调用边界返回的异常能被转换；在它之前已经抛出的错误，或者被下游自己处理掉的错误，不会自动来到这里。

若找到 AuthenticationException 或 AccessDeniedException，但响应已经提交，过滤器会抛出 ServletException，不能重新写一个登录重定向或错误页。非安全异常则沿原有异常路径传播。

## 先看异常类型，再看身份强度

| 异常与当前身份 | 委托对象 | 典型目的 |
| --- | --- | --- |
| AuthenticationException | AuthenticationEntryPoint | 开始认证或返回认证要求 |
| AccessDeniedException，匿名用户 | AuthenticationEntryPoint | 先取得真实身份再尝试访问 |
| AccessDeniedException，Remember-Me 身份 | AuthenticationEntryPoint | 要求更完整的认证 |
| AccessDeniedException，其他认证状态 | AccessDeniedHandler | 表达该主体不被允许访问 |

这里使用 AuthenticationTrustResolver 判断匿名和 Remember-Me，不能只检查 `isAuthenticated()`。后者在匿名令牌上也可能为 true。

AuthenticationEntryPoint 具体做什么由配置决定：表单登录可重定向到登录页，HTTP Basic 可返回 401，预认证场景也可选择直接拒绝的入口。过滤器本身没有“所有认证失败都返回同一个状态码”的承诺。

## 发起认证前清空当前认证并保存请求

```java
protected void sendStartAuthentication(HttpServletRequest request,
        HttpServletResponse response, FilterChain chain,
        AuthenticationException reason) throws ServletException, IOException {
    // SEC-112: Clear the SecurityContextHolder's Authentication, as the
    // existing Authentication is no longer considered valid
    SecurityContextHolder.getContext().setAuthentication(null);
    requestCache.saveRequest(request, response);
    logger.debug("Calling Authentication entry point.");
    authenticationEntryPoint.commence(request, response, reason);
}
```

这段代码先清除当前上下文中的 Authentication，再通过 RequestCache 保存请求，最后调用入口的 commence。默认 HttpSessionRequestCache 可配合登录成功处理器恢复此前访问目标；它并不意味着任意请求体、任意客户端动作都能无损重放。

如果应用是无状态 API，应从实际配置核对请求缓存和入口行为，而不是从默认字段推断一定会建立或复用会话。

## 两种常见处理器怎样形成不同响应

### Http403ForbiddenEntryPoint：直接拒绝

该入口的 commence 调用 `response.sendError(403, "Access Denied")`。它适用于已有上游预认证机制却无法建立认证的情况，不能把它当成表单登录的统一默认值。[固定版本源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/authentication/Http403ForbiddenEntryPoint.java)

### AccessDeniedHandlerImpl：403 与可选服务端转发

默认拒绝处理器在响应未提交时执行以下分支：

| 是否配置 errorPage | 动作 |
| --- | --- |
| 没有 | `sendError(403)` |
| 有 | 将异常放到请求属性、设置 403，再用 RequestDispatcher.forward 转发到错误页 |

forward 是服务端转发，浏览器地址不会因为它自动跳到另一个 URL；它与返回 302/303 的重定向不同。错误页路径要求以 `/` 开头，且响应已提交时不能再改变既成结果。[AccessDeniedHandlerImpl 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/access/AccessDeniedHandlerImpl.java)

## 用三个请求检查配置语义

| 场景 | 要观察的结果 |
| --- | --- |
| 未登录访问受保护资源 | 是否到达所配置的认证入口，登录后能否按缓存策略返回 |
| Remember-Me 身份访问要求完整认证的资源 | 是否重新发起完整认证 |
| 完整认证但没有所需权限 | 是否进入拒绝处理器，状态码和错误页是否符合契约 |

这些是验证配置的方法，不是本文对某个应用已经通过集成测试的声明。排查时先定位原异常的产生位置，再核对当前身份与实际配置的处理器；只改错误页或状态码不会修正产生拒绝的认证、授权规则。
