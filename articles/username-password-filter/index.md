---
title: "UsernamePasswordAuthenticationFilter 源码分析"
date: 2019-06-08
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

浏览器提交用户名和密码后，请求会经过好几个环节才变成“登录成功”。表单字段要先被读出来，凭据要交给认证组件校验，结果还要写入上下文，最后浏览器才收到跳转或失败响应。

`UsernamePasswordAuthenticationFilter` 处在 HTTP 请求与认证过程的交界处。沿一次 `POST /login` 看它的父类和子类如何配合，能解释为什么字段名、CSRF、会话策略或成功处理器都可能改变登录结果。

本文分析 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的 Servlet 表单流程。最小运行工程及 JDK 配套版本见[基本概念](/spring-security-basics/)。固定源码见 [UsernamePasswordAuthenticationFilter](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/authentication/UsernamePasswordAuthenticationFilter.java) 与 [AbstractAuthenticationProcessingFilter](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/authentication/AbstractAuthenticationProcessingFilter.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 先确认请求是否到达登录处理分支

默认 RequestMatcher 匹配 `POST /login`，默认字段名是 `username` 和 `password`。过滤器通过 `request.getParameter` 读取表单参数，不会自动解析 JSON 请求体。登录页面的 GET 请求与提交表单的 POST 请求是不同入口。

应用可以改变匹配器、处理 URL 和字段名。`postOnly=false` 只关闭 attemptAuthentication 内部的 POST 检查，不会自动把仍限制 POST 的 RequestMatcher 改成匹配 GET。

使用框架生成的登录页可以同时带上 CSRF 所需信息。自行发送表单时，认证过滤器前面的 CSRF 检查也可能拒绝请求，因此“没有进入密码校验”不一定是用户名字段错误。

## 从表单参数得到认证结果

请求匹配后，父类负责安排处理顺序，子类负责把这次 HTTP 输入交给认证管理器。

### 父类如何接住子类的返回值

AbstractAuthenticationProcessingFilter 的 doFilter 先调用 requiresAuthentication；不匹配就直接继续原链。匹配时调用子类：

```java
authResult = attemptAuthentication(request, response);
if (authResult == null) {
    return;
}
sessionStrategy.onAuthentication(authResult, request, response);
```

| 返回或异常 | 后续路径 |
| --- | --- |
| 非 null 认证结果 | 执行会话认证策略，再进入成功处理 |
| null | 子类尚未完成认证，立即结束本次过滤器处理 |
| AuthenticationException，包括会话策略抛出的同类异常 | 进入失败处理 |

null 不是密码错误的另一种写法，它给多阶段认证留下了“处理尚未完成”的契约。InternalAuthenticationServiceException 会额外记录内部错误，但仍进入认证失败处理路径。

### 子类读取参数并调用 AuthenticationManager

关注下面三个位置：缺失参数如何处理、令牌用什么构造器建立，以及最后一行把校验交给谁。

```java
public Authentication attemptAuthentication(HttpServletRequest request,
        HttpServletResponse response) throws AuthenticationException {
    if (postOnly && !request.getMethod().equals("POST")) {
        throw new AuthenticationServiceException(
                "Authentication method not supported: " + request.getMethod());
    }

    String username = obtainUsername(request);
    String password = obtainPassword(request);

    if (username == null) {
        username = "";
    }

    if (password == null) {
        password = "";
    }

    username = username.trim();

    UsernamePasswordAuthenticationToken authRequest = new UsernamePasswordAuthenticationToken(
            username, password);

    // Allow subclasses to set the "details" property
    setDetails(request, authRequest);

    return this.getAuthenticationManager().authenticate(authRequest);
}
```

该版本把缺失参数转换为空字符串，并对用户名调用 trim；然后创建未认证的 UsernamePasswordAuthenticationToken，附加请求详情，调用管理器。这里没有查询数据库，也没有直接比较密码。[提供者选择与 DAO 校验](/authentication-manager/)属于下一层。

## 认证结果怎样变成浏览器响应

同样是认证完成，成功与失败会更新不同的状态，并调用不同的响应处理器。

### 成功后保存身份并处理会话

成功后先执行 SessionAuthenticationStrategy，具体实现可以处理会话固定攻击防护或并发会话约束。父类字段初始值是空策略，但实际过滤器由配置器装配，不能把字段默认值当成表单登录的全部运行配置。

默认 `continueChainBeforeSuccessfulAuthentication=false`，父类不继续原来的业务过滤链，而是进入 successfulAuthentication。其关键操作是：

```java
SecurityContextHolder.getContext().setAuthentication(authResult);
rememberMeServices.loginSuccess(request, response, authResult);
eventPublisher.publishEvent(new InteractiveAuthenticationSuccessEvent(
        authResult, this.getClass()));
successHandler.onAuthenticationSuccess(request, response, authResult);
```

摘录省略了日志与 eventPublisher 的非空条件。安全上下文保存认证结果，RememberMeServices 处理相应记住我能力，事件发布用于通知，SuccessHandler 决定响应。跨请求会话保存还依赖外层 [SecurityContextPersistenceFilter](/security-context-persistence/)。

若显式开启 continueChainBeforeSuccessfulAuthentication，下游链会在 successfulAuthentication **之前**执行，也就是不能假定此时父类已经把新认证结果写入 Holder。这个顺序与字段名称一起读才不会误解。

### 为什么登录后能回到原来的页面

SavedRequestAwareAuthenticationSuccessHandler 从 RequestCache 查找之前的受保护请求。有保存目标且没有配置其他优先跳转策略时，重定向到那个目标；否则委托父类处理默认 URL 或目标参数。默认目标一般为 `/`。[成功处理器源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/authentication/SavedRequestAwareAuthenticationSuccessHandler.java)

### 失败后清理身份并返回错误

unsuccessfulAuthentication 清理 SecurityContextHolder，通知 RememberMeServices 登录失败，再调用 AuthenticationFailureHandler。默认字段使用 SimpleUrlAuthenticationFailureHandler，其行为取决于实际配置：

| 配置 | 失败响应 |
| --- | --- |
| 没有失败 URL | 发送 401 |
| 有失败 URL，forwardToDestination=false | 保存异常后重定向 |
| 有失败 URL，forwardToDestination=true | 将异常置于请求属性并服务端转发 |

表单配置器可以设置失败 URL，因而运行中的登录页失败跳转不能仅从“默认字段构造器没有 URL”推断。[失败处理器源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/authentication/SimpleUrlAuthenticationFailureHandler.java)

## 从浏览器现象定位到具体阶段

用相同运行工程比较：未登录访问受保护页、提交正确表单、返回原目标；提交错误密码、显示失败信息、重新成功登录；登录后再请求同一资源。额外核对请求方法、字段名和 CSRF 条件，才能分清入口匹配、凭据失败和响应处理问题。

若要实现 JSON 登录，需要明确新的输入解析与响应契约；不能仅改 Content-Type 就期待这条表单过滤器自动读取 JSON。认证提供者仍可复用，HTTP 适配责任则应留在相应入口。
