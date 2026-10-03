---
title: "FilterChainProxy 源码分析"
date: 2019-07-01
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security过滤流程
domain: Spring
---

配置了多条安全链，不意味着一个请求会把所有匹配链依次执行。FilterChainProxy 只选择按顺序遇到的第一条匹配链，再调用该链中的过滤器；匹配范围和顺序因此直接决定实际保护范围。

本文研究 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的 Servlet 请求执行过程，前置背景是 [WebSecurity 如何构建多条链](/web-security/)。固定源码见 [FilterChainProxy 5.1.5](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/FilterChainProxy.java)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 先区分三条调用关系

```text
Servlet 容器原始过滤链
  → DelegatingFilterProxy
    → FilterChainProxy
      → 第一条匹配的 SecurityFilterChain 内部过滤器
        → 继续原始 Servlet 过滤链与最终请求处理
```

最后一条箭头有条件：安全过滤器可以拒绝访问、发送重定向或完成响应而不再调用 chain。FilterChainProxy 负责调度，不保证每个请求都到达 Controller。

## HttpFirewall 先检查并包装请求

`doFilterInternal` 先调用 HttpFirewall 取得 FirewalledRequest 和包装后的响应，默认使用 StrictHttpFirewall。请求被认为不合法时可能在选链之前被拒绝，不能把所有拒绝都归为授权规则不匹配。

然后代理调用 getFilters，传入经过防火墙处理的请求。匹配结束后，进入安全链或返回原始链；适当阶段调用 FirewalledRequest.reset，恢复继续处理所需的请求状态。

## getFilters 在第一条匹配处停止

```java
private List<Filter> getFilters(HttpServletRequest request) {
    for (SecurityFilterChain chain : filterChains) {
        if (chain.matches(request)) {
            return chain.getFilters();
        }
    }

    return null;
}
```

用两个匹配器的顺序可以说明结果。假设 A 匹配 `/api/**`，B 匹配所有请求：

| 配置顺序与请求 | 选中的链 |
| --- | --- |
| A、B；请求 `/api/orders` | A |
| A、B；请求 `/home` | B |
| B、A；请求 `/api/orders` | B，A 不再被检查 |
| 没有任何匹配 | 返回 null，继续原始 Servlet 链 |

匹配到一条过滤器列表为空的链时，同样直接继续原始链。WebSecurity 的忽略规则就是利用这个路径；后面再放一条更严格的链也不会补上被跳过的检查。

## VirtualFilterChain 怎样逐个调用过滤器

选中非空过滤器列表后，代理创建 VirtualFilterChain。它保存原始 FilterChain、额外过滤器列表和当前位置，每次调用按以下逻辑推进：

```java
if (currentPosition == size) {
    this.firewalledRequest.reset();
    originalChain.doFilter(request, response);
}
else {
    currentPosition++;
    Filter nextFilter = additionalFilters.get(currentPosition - 1);
    nextFilter.doFilter(request, response, this);
}
```

这里省略日志。传给下一个过滤器的 chain 是 VirtualFilterChain 自己，所以过滤器调用 `chain.doFilter` 会重新进入同一个调度对象；当前位置已经递增，不会反复调用同一个过滤器。走到列表末尾后才切回原始 Servlet 链。

这也是过滤器可以形成“进入时处理、返回时清理”结构的原因：调用下游是普通方法调用，结果或异常会沿调用栈返回到外层过滤器。

## 上下文清理属于最外层调用边界

FilterChainProxy 用请求属性记录是否已进入自己的外层调用。首次进入时在 finally 中清理 SecurityContextHolder 并移除标记；嵌套调用仍可执行内部链，但不会在内层提前清除外层持有的上下文。

这个清理与 [SecurityContextPersistenceFilter](/security-context-persistence/) 的仓库保存职责不同。一个负责请求调度边界的最终清理，另一个负责加载、保存与线程绑定生命周期，不能把清理 Holder 理解成删除 HttpSession。

## 排查时先确认命中哪条链

应分别观察防火墙是否接受请求、getFilters 选中了哪条链、链内哪个过滤器提前返回，以及是否最终进入原始 Servlet 链。只看到安全 Bean 已存在，或某条规则能保护一个 URL，都不能证明其他路径也被覆盖。

多链配置的代表性检查至少包含专用路径、公共路径、没有匹配的路径和重叠路径；它们检验的是匹配关系，不是构建是否成功。
