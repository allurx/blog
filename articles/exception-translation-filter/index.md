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

访问同一个管理页面，未登录时会跳到登录页，登录后权限不足却会收到 403。两次请求都被授权规则拒绝，为什么响应不同？ExceptionTranslationFilter 会接住下游抛出的安全异常，再结合当前身份，决定让用户开始认证，还是直接告诉他没有访问权限。

沿着这个请求看，它处在“安全判断已经失败”与“向客户端发送响应”之间。密码是否正确、权限是否足够由认证和授权组件判断；这里要解决的是失败之后怎么办。

本文分析 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的 Servlet 过滤链。前置知识是 AuthenticationException、AccessDeniedException 和[匿名身份](/anonymous-authentication/)。固定实现见 [ExceptionTranslationFilter 5.1.5](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/access/ExceptionTranslationFilter.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 为什么过滤器位置会影响异常能否被处理

它把下游 `chain.doFilter(request, response)` 放进 try，再检查传播回来的异常原因链。只有从这个调用边界返回的异常能被转换；在它之前已经抛出的错误，或者被下游自己处理掉的错误，不会自动来到这里。

若找到 AuthenticationException 或 AccessDeniedException，但响应已经提交，过滤器会抛出 ServletException，不能重新写一个登录重定向或错误页。非安全异常则沿原有异常路径传播。

## 同一次访问拒绝，为什么会走向两个出口

### 匿名和 Remember-Me 身份先进入认证流程

假设 `/admin` 要求管理员权限。匿名访问时，直接显示“权限不足”并不能帮助用户完成访问，因为应用还没有取得足够的身份信息。过滤器因此可以把授权拒绝转成一次认证要求。Remember-Me 身份也可能需要重新完成登录，才能满足资源要求。

| 异常与当前身份 | 委托对象 | 典型目的 |
| --- | --- | --- |
| AuthenticationException | AuthenticationEntryPoint | 开始认证或返回认证要求 |
| AccessDeniedException，匿名用户 | AuthenticationEntryPoint | 先取得真实身份再尝试访问 |
| AccessDeniedException，Remember-Me 身份 | AuthenticationEntryPoint | 要求更完整的认证 |
| AccessDeniedException，其他认证状态 | AccessDeniedHandler | 表达该主体不被允许访问 |

这里使用 AuthenticationTrustResolver 判断匿名和 Remember-Me，不能只检查 `isAuthenticated()`。后者在匿名令牌上也可能为 true。

AuthenticationEntryPoint 具体做什么由配置决定：表单登录可重定向到登录页，HTTP Basic 可返回 401，预认证场景也可选择直接拒绝的入口。过滤器本身没有“所有认证失败都返回同一个状态码”的承诺。

### 已有充分身份时，由拒绝处理器响应

如果用户已经完成认证，仍然没有管理员权限，再跳回登录页通常不能解决问题。这时 `AccessDeniedException` 被交给 `AccessDeniedHandler`。表中的分支说明了过滤器如何选择出口；具体返回什么页面或状态码，仍取决于出口的实现。

## 开始认证时，原请求怎样留下来

用户从 `/admin` 被带到登录页后，往往希望登录成功能回到原位置。下面这段方法连接了上下文、请求缓存和认证入口，执行顺序正好对应这三个动作：

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

这三次访问可以把认证入口问题与授权规则问题区分开。若完整认证用户仍被送回登录页，先核对异常类型和身份判定；若进入拒绝处理器，则继续检查权限与规则。表中列出的是配置检查的观察点，具体应用还需要按自己的登录方式执行这条操作链。
