---
title: "AnonymousAuthenticationFilter 源码分析"
date: 2019-06-12
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

授权代码需要处理未登录访问，但不必在每个位置都把 null 当作一种额外用户类型。AnonymousAuthenticationFilter 在安全上下文还没有 Authentication 时补入匿名令牌，让后续组件能够通过统一接口判断身份与权限。

本文分析 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的 Servlet 过滤链，属于历史源码研究。前置背景是 [Authentication 与 SecurityContext](/spring-security-basics/)；原始实现见 [AnonymousAuthenticationFilter 5.1.5](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/authentication/AnonymousAuthenticationFilter.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 先看它进入链时可能遇到的状态

| 上下文状态 | 当前过滤器的动作 |
| --- | --- |
| 前面的认证过滤器已设置 Authentication | 保留已有认证信息 |
| 尚无 Authentication | 创建并设置匿名令牌 |
| 已有对象但 authenticated 为 false | 仍保留对象；这里检查的是 null，不重新认证它 |

这说明它不负责用户名密码或令牌校验，也不保证经过它的所有请求都拥有真实用户身份。实际顺序由配置产生，通常在普通认证过滤器之后、请求授权之前。

## doFilter 的唯一补全条件

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {

    if (SecurityContextHolder.getContext().getAuthentication() == null) {
        SecurityContextHolder.getContext().setAuthentication(
                createAuthentication((HttpServletRequest) req));

        if (logger.isDebugEnabled()) {
            logger.debug("Populated SecurityContextHolder with anonymous token: '"
                    + SecurityContextHolder.getContext().getAuthentication() + "'");
        }
    }
    else {
        if (logger.isDebugEnabled()) {
            logger.debug("SecurityContextHolder not populated with anonymous token, as it already contained: '"
                    + SecurityContextHolder.getContext().getAuthentication() + "'");
        }
    }

    chain.doFilter(req, res);
}
```

两个分支之后都会调用下游链。匿名令牌本身不会让请求提前成功，也不会覆盖已经登录的用户；后续授权规则仍可能允许或拒绝访问。

## 匿名主体、权限与请求详情从哪里来

默认构造器把 principal 设为 `anonymousUser`，权限设为 `ROLE_ANONYMOUS`；应用可以在配置时替换它们。创建令牌的实现如下：

```java
protected Authentication createAuthentication(HttpServletRequest request) {
    AnonymousAuthenticationToken auth = new AnonymousAuthenticationToken(key,
            principal, authorities);
    auth.setDetails(authenticationDetailsSource.buildDetails(request));

    return auth;
}
```

WebAuthenticationDetailsSource 默认加入客户端地址和已有会话的标识等请求详情。这些信息用于描述请求，不是额外身份凭据。

构造器还接收一个 key，与相应 AnonymousAuthenticationProvider 的配置配合使用；它不应该被当作对外访问令牌或用户密码。匿名令牌的 authenticated 状态属于框架内部信任模型，与“用户已输入并通过真实凭据”不是一回事。

## 怎样判断匿名访问是否会被允许

应该看授权规则及 AuthenticationTrustResolver 对身份的解释，而不是只看 `isAuthenticated()`。例如允许匿名访问的资源可以继续执行，要求完整认证的资源则可能由授权组件拒绝，并交给 [ExceptionTranslationFilter](/exception-translation-filter/) 发起登录。

本篇的可观察结果是上下文是否被补全、原有认证是否被保留，以及下游授权的最终响应。检查时至少覆盖无认证、已有真实认证和禁用匿名支持这三种配置；仅看到 `anonymousUser` 日志不能证明接口已公开，也不能证明用户已登录。
