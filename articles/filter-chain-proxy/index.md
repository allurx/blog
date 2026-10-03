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

为 `/api/**` 配了一条专用安全链，又给整站配了一条兜底链，接口却仍然跳到表单登录页。遇到这种现象，先看两条链的顺序：FilterChainProxy 找到第一条匹配链就停止查找。若兜底链排在前面，接口请求根本没有机会进入专用链。

选中链之后，代理还要逐个调用链内过滤器，并在适当时机回到 Servlet 容器原本的过滤链。理解这两个动作，就能沿一条请求解释“规则为什么没生效”和“Controller 为什么没有执行”。

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

## 从请求进入到选中安全链

### HttpFirewall 先检查并包装请求

`doFilterInternal` 先调用 HttpFirewall 取得 FirewalledRequest 和包装后的响应，默认使用 StrictHttpFirewall。请求被认为不合法时可能在选链之前被拒绝，不能把所有拒绝都归为授权规则不匹配。

然后代理调用 getFilters，传入经过防火墙处理的请求。匹配结束后，进入安全链或返回原始链；适当阶段调用 FirewalledRequest.reset，恢复继续处理所需的请求状态。

### getFilters 在第一条匹配处停止

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

第一行对应预期的 API 专用配置，第三行就是开篇故障的原因。这里的顺序发生在链与链之间，还没有涉及链内授权表达式。

匹配到一条过滤器列表为空的链时，同样直接继续原始链。WebSecurity 的忽略规则利用了这个路径：请求一旦选中空链，后面的严格链就不再参与。

## 选中链之后，调用怎样推进和返回

### VirtualFilterChain 维护下一项的位置

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

可以把两个安全过滤器的执行顺序展开成 `A 进入 → B 进入 → 原始链 → B 返回 → A 返回`。调用下游是普通方法调用，异常也沿这个调用栈向外传播。因此，外层过滤器可以在调用前准备上下文，并在下游完成后清理；某个过滤器若提前写入响应且没有继续调用，后面的阶段就不会发生。

### 最外层 finally 负责最终清理

FilterChainProxy 用请求属性记录是否已进入自己的外层调用。首次进入时在 finally 中清理 SecurityContextHolder 并移除标记；嵌套调用仍可执行内部链，但不会在内层提前清除外层持有的上下文。

这个清理与 [SecurityContextPersistenceFilter](/security-context-persistence/) 的仓库保存职责不同。一个负责请求调度边界的最终清理，另一个负责加载、保存与线程绑定生命周期，不能把清理 Holder 理解成删除 HttpSession。

## 排查时先确认命中哪条链

回到 `/api/orders` 跳登录页的问题，可以先在 `getFilters` 确认选中的链，再查看该链实际包含的认证入口和过滤器。如果请求在选链之前就失败，则检查防火墙；如果链正确却没有进入业务处理，则沿 `VirtualFilterChain` 找出停止调用下游的位置。这样每一步都缩小了问题范围。

多链配置的代表性检查至少包含专用路径、公共路径、没有匹配的路径和重叠路径；它们检验的是匹配关系，不是构建是否成功。
