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

没有登录的浏览器访问首页，日志里却出现了 `anonymousUser`，甚至对应令牌的 `isAuthenticated()` 还是 `true`。这并不说明系统替访客完成了一次真实登录：`AnonymousAuthenticationFilter` 给未登录请求补了一个框架能够识别的匿名身份。

这个设计让授权组件也能用 `Authentication` 处理访客。它仍然需要区分匿名用户和真实用户，允许哪些访问则由后面的规则决定。

本文以 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的 Servlet 过滤链为准。前置背景是 [Authentication 与 SecurityContext](/spring-security-basics/)；原始实现见 [AnonymousAuthenticationFilter 5.1.5](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/authentication/AnonymousAuthenticationFilter.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 请求经过过滤器时发生什么

### 是否补入匿名身份，只看上下文是否为空

| 上下文状态 | 当前过滤器的动作 |
| --- | --- |
| 前面的认证过滤器已设置 Authentication | 保留已有认证信息 |
| 尚无 Authentication | 创建并设置匿名令牌 |
| 已有对象但 authenticated 为 false | 仍保留对象；这里检查的是 null，不重新认证它 |

这说明它不负责用户名密码或令牌校验，也不保证经过它的所有请求都拥有真实用户身份。实际顺序由配置产生，通常在普通认证过滤器之后、请求授权之前。

### 沿 doFilter 看一次未登录请求

对没有认证信息的首页请求，下面的 `if` 成立：过滤器创建令牌，将它放入当前 `SecurityContext`，然后继续执行过滤链。已经完成登录的请求走另一条分支，保留前面认证过滤器放入的结果。

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

两个分支最终都到达 `chain.doFilter`。因此，这个过滤器完成的是身份补全，响应还没有由它决定：同一个匿名身份访问公开首页可以继续，访问管理接口仍可能被拒绝。

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

现在再看开篇的日志就容易理解了。`anonymousUser` 说明当前上下文采用了匿名令牌；要判断页面为何能打开，继续看首页的授权规则。要判断为何跳到了登录页，则沿拒绝结果去看异常转换和认证入口。身份补全、权限判断和最终响应分别发生在不同位置，单条匿名日志只能解释其中第一步。
