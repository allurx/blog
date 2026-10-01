---
title: AnonymousAuthenticationFilter源码分析
date: 2019-06-12
id: 2019-06-12-spring-security-anonymous-authentication-filter
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

## 核心结论

AnonymousAuthenticationFilter 仅在上下文没有 Authentication 时补入匿名令牌，使后续授权组件能够统一处理请求。匿名令牌的 authenticated 状态是框架内部的令牌状态，不能据此认定访问者已通过用户名、密码或其他真实凭据认证。

## 问题与适用范围

本文回答：未登录请求为什么也能从 SecurityContext 中取得 Authentication？

本文分析 Servlet 过滤器链中的匿名认证支持。该过滤器不会覆盖已经存在的认证信息；是否允许匿名访问由授权规则决定。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

spring-security为了使整个认证流程中的SecurityContext中始终存在一个Authentication信息，在过滤器链的认证阶段尾部填充了一个名为AnonymousAuthenticationFilter的过滤器，该过滤的主要作用是当认证阶段结束后，检测SecurityContextHolder中是否存在Authentication对象，如果不存在则用一个匿名的认证令牌填充进去。

<!-- more -->

## AnonymousAuthenticationFilter

```java
public class AnonymousAuthenticationFilter extends GenericFilterBean implements
      InitializingBean {

   // 认证请求详情，默认是WebAuthenticationDetailsSource，主要是获取ip地址和session id
   private AuthenticationDetailsSource<HttpServletRequest, ?> authenticationDetailsSource = new WebAuthenticationDetailsSource();


   private String key;

   // 用户名
   private Object principal;

   // 权限
   private List<GrantedAuthority> authorities;

   // 默认的匿名用户信息
   public AnonymousAuthenticationFilter(String key) {
      this(key, "anonymousUser", AuthorityUtils.createAuthorityList("ROLE_ANONYMOUS"));
   }

   // 自定义匿名用户信息
   public AnonymousAuthenticationFilter(String key, Object principal,
         List<GrantedAuthority> authorities) {
      Assert.hasLength(key, "key cannot be null or empty");
      Assert.notNull(principal, "Anonymous authentication principal must be set");
      Assert.notNull(authorities, "Anonymous authorities must be set");
      this.key = key;
      this.principal = principal;
      this.authorities = authorities;
   }


   @Override
   public void afterPropertiesSet() {
      Assert.hasLength(key, "key must have length");
      Assert.notNull(principal, "Anonymous authentication principal must be set");
      Assert.notNull(authorities, "Anonymous authorities must be set");
   }

   public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
         throws IOException, ServletException {
	  // 如果当前请求上下文中没有认证信息，则填充一个匿名的令牌
      if (SecurityContextHolder.getContext().getAuthentication() == null) {
         SecurityContextHolder.getContext().setAuthentication(
               // 创建匿名令牌
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

   protected Authentication createAuthentication(HttpServletRequest request) {

      // 构造匿名令牌
      AnonymousAuthenticationToken auth = new AnonymousAuthenticationToken(key,
            principal, authorities);
      auth.setDetails(authenticationDetailsSource.buildDetails(request));

      return auth;
   }

   public void setAuthenticationDetailsSource(
         AuthenticationDetailsSource<HttpServletRequest, ?> authenticationDetailsSource) {
      Assert.notNull(authenticationDetailsSource,
            "AuthenticationDetailsSource required");
      this.authenticationDetailsSource = authenticationDetailsSource;
   }

   public Object getPrincipal() {
      return principal;
   }

   public List<GrantedAuthority> getAuthorities() {
      return authorities;
   }
}
```

## 总结

AnonymousAuthenticationFilter的源码很简单，当请求走到这个过滤器的时候，如果之前的一些认证过滤器没有往SecurityContext中填充认证令牌，就会填充一个匿名令牌到其中。此时当前请求的用户就是匿名用户。

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
