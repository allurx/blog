---
title: "FilterSecurityInterceptor 源码分析"
date: 2019-06-14
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

HTTP 请求进入业务处理之前，FilterSecurityInterceptor 把请求包装为安全对象，读取规则并调用访问决策器。它还借助基类维护临时身份和调用后处理，但这些扩展不等于直接拦截 Controller 方法或修改其返回值。

本文研究 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE**。前置知识是 Authentication、ConfigAttribute 与[访问决策器](/access-decision-manager/)；固定源码见 [FilterSecurityInterceptor](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/access/intercept/FilterSecurityInterceptor.java) 和 [AbstractSecurityInterceptor](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/core/src/main/java/org/springframework/security/access/intercept/AbstractSecurityInterceptor.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 一次 HTTP 授权怎样被包围

FilterInvocation 保存请求、响应和下游 FilterChain，随后 invoke 把调用分为前置决策、执行、恢复与后置处理：

```java
public void invoke(FilterInvocation fi) throws IOException, ServletException {
    if ((fi.getRequest() != null)
            && (fi.getRequest().getAttribute(FILTER_APPLIED) != null)
            && observeOncePerRequest) {
        // filter already applied to this request and user wants us to observe
        // once-per-request handling, so don't re-do security checking
        fi.getChain().doFilter(fi.getRequest(), fi.getResponse());
    }
    else {
        // first time this request being called, so perform security checking
        if (fi.getRequest() != null && observeOncePerRequest) {
            fi.getRequest().setAttribute(FILTER_APPLIED, Boolean.TRUE);
        }

        InterceptorStatusToken token = super.beforeInvocation(fi);

        try {
            fi.getChain().doFilter(fi.getRequest(), fi.getResponse());
        }
        finally {
            super.finallyInvocation(token);
        }

        super.afterInvocation(token, null);
    }
}
```

默认 observeOncePerRequest 使用请求属性避免同一请求重复执行授权边界。若直接进入其跳过分支，就继续下游链；是否需要重复授权仍与转发、分派和配置有关。

最关键的顺序是：beforeInvocation 抛异常时，不会进入业务链；下游正常返回或抛异常都会执行 finallyInvocation；只有正常返回后才继续 afterInvocation。不能把后置处理描述成无条件执行。

## beforeInvocation 先取得规则，再决定是否需要认证

元数据源根据安全对象返回 ConfigAttribute 集合。本文的 HTTP 路径通常使用表达式元数据源，其父类按 RequestMatcher 的配置顺序查找，返回第一项匹配的属性。

| 元数据结果 | 处理方式 |
| --- | --- |
| 没有属性，rejectPublicInvocations=false | 视为公共调用，返回 null 状态令牌，不尝试认证 |
| 没有属性，rejectPublicInvocations=true | 作为配置错误拒绝 |
| 有属性，但上下文没有 Authentication | 抛 AuthenticationCredentialsNotFoundException |
| 有属性且有 Authentication | 按需重新认证，然后调用访问决策器 |

“没有配置属性”和一个显式 `permitAll` 表达式不是同一个内部路径。前者可以直接视为公共调用，后者仍是交给决策体系求值的规则。

同一 URL 配置多条规则时，首先要看匹配顺序，而不是假定所有匹配属性会自动合并。[DefaultFilterInvocationSecurityMetadataSource 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/access/intercept/DefaultFilterInvocationSecurityMetadataSource.java)

## 认证与授权在这里相继发生

`authenticateIfRequired()` 在令牌已经被信任且不要求始终重新认证时复用它；否则委托 AuthenticationManager，更新上下文后取得结果。接着执行：

```java
this.accessDecisionManager.decide(authenticated, object, attributes);
```

正常返回表示当前受保护调用获准继续；AccessDeniedException 会发布相应失败事件并向外传播。匿名令牌也可能具有 authenticated 状态，能否访问仍由授权规则判断。[投票规则与全部弃权边界](/access-decision-manager/)

## RunAs 临时替换身份，finally 恢复原绑定

授权通过后，RunAsManager 可以返回一次调用专用的 Authentication。NullRunAsManager 不替换身份；RunAsManagerImpl 识别 `RUN_AS_` 属性，在原权限基础上增加相应临时权限，并与配套提供者使用一致的 key。

发生替换时，基类保存原 SecurityContext，创建新的空上下文并设置临时认证，随后把原上下文放进 InterceptorStatusToken。它不在原会话上下文对象上直接改来改去，也不绕过前面的访问决策。

```java
protected void finallyInvocation(InterceptorStatusToken token) {
    if (token != null && token.isContextHolderRefreshRequired()) {
        if (logger.isDebugEnabled()) {
            logger.debug("Reverting to original Authentication: "
                    + token.getSecurityContext().getAuthentication());
        }

        SecurityContextHolder.setContext(token.getSecurityContext());
    }
}
```

这个恢复在下游失败时也会执行，避免临时身份泄漏到外层后续逻辑。[RunAsManagerImpl 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/core/src/main/java/org/springframework/security/access/intercept/RunAsManagerImpl.java)

## afterInvocation 的返回值边界

AbstractSecurityInterceptor 可以把返回值交给 AfterInvocationManager 做后置授权或过滤，但 FilterSecurityInterceptor 调用时传入的是 null，因为 Servlet FilterChain 没有业务返回值。因此不能据此声称它会过滤 Controller 返回的集合。

方法安全拦截器也会复用这个基类，但它保护 MethodInvocation，能够取得方法返回值；两种安全对象不同，扩展能力不能仅凭共同父类互相套用。

## 把访问失败定位到正确阶段

先确认元数据是否匹配到预期规则，再检查是否有认证信息、是否重新认证、决策器为何拒绝；若使用 RunAs，还要检查调用后上下文已恢复。向外传播的安全异常通常由位于外层的 [ExceptionTranslationFilter](/exception-translation-filter/)转换为响应，但响应已经提交时不能再假定能返回标准错误页。

最小配置观察应包含无匹配属性、匿名访问、已登录但无权限、正常放行，以及业务链抛异常时的状态恢复。源码中的可选字段不等于应用已经启用相应扩展。
