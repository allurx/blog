---
title: Spring-Security基本概念
date: 2019-06-02
id: 2019-06-02-spring-security-fundamentals
tags:
  - Spring
  - Spring-Security
  - Spring-Security基本概念
domain: Spring
---

## 核心结论

Servlet 应用通过 FilterChainProxy 选择匹配的 SecurityFilterChain，再依次执行链上的过滤器。SecurityContext 保存 Authentication，认证回答“当前主体是谁”，授权根据该主体和权限决定是否允许操作；有 Authentication 对象并不意味着用户已经完成登录。

## 问题与适用范围

本文回答：Spring Security 如何把一个 HTTP 请求中的认证与授权连接起来？

本文以表单登录的 Servlet 过滤器链为例，介绍 SecurityContext、Authentication 与认证令牌。过滤器是否出现及顺序由实际配置决定，下面列出的默认链不是所有应用的固定清单。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

本文主要讲解spring-security相关的一些基本概念，熟悉一些相关的类和认证大概流程。不涉及源码的探讨，为接下来的几篇深入解析作铺垫。本文以及接下来的文章使用的Spring Boot版本为：
```
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.1.5.RELEASE</version>
</parent>
```
<!-- more -->
## spring-security简述

### 概念

spring-security是一个功能强大且可高度自定义的身份验证和访问控制框架。 它是保护基于Spring的应用程序的事实标准。

### 运行原理

spring-security是通过过滤器链对web请求进行拦截，不同的过滤器按照定义的拦截规则对相应的请求进行拦截然后进行处理。

## spring-security基本过滤链

新建Spring Boot工程，添加spring-security依赖：
```
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
```
开启debug调试：
```
logging:
  level:
    org.springframework.security: debug
```
启动项目，从控制台打印的信息可以看到，spring-security为当前项目添加了一个DefaultSecurityFilterChain，该过滤器链包含以下过滤器：
```
WebAsyncManagerIntegrationFilter
SecurityContextPersistenceFilter
HeaderWriterFilter
CsrfFilter
LogoutFilter
UsernamePasswordAuthenticationFilter
DefaultLoginPageGeneratingFilter
DefaultLogoutPageGeneratingFilter
BasicAuthenticationFilter
RequestCacheAwareFilter
SecurityContextHolderAwareRequestFilter
AnonymousAuthenticationFilter
SessionManagementFilter
ExceptionTranslationFilter
FilterSecurityInterceptor
```
这些过滤器从上往下的顺序代表了执行的先后顺序。

## Spring-Security核心认证类

从上面的过滤器链中，我们可以猜想既然是过滤链，那么是不是会存在一个东西从请求进入过滤链到请求结束，扮演着某个角色，代表着过滤所得到的结果呢？答案是肯定的，其实spring-security的整个认证和授权最终就是围绕着这个东西进行的。

### SecurityContext

记住这个类是贯穿整个过滤器链的，后续一系列的认证授权都是围绕它展开的。它的实现类只有一个SecurityContextImpl，这个类从名字上可以看出它代表的是安全上下文信息，看一下SecurityContextImpl类：
``` java
public class SecurityContextImpl implements SecurityContext {

	private static final long serialVersionUID = SpringSecurityCoreVersion.SERIAL_VERSION_UID;

	private Authentication authentication;

	public SecurityContextImpl() {}

	public SecurityContextImpl(Authentication authentication) {
		this.authentication = authentication;
	}

	@Override
	public boolean equals(Object obj) {
		if (obj instanceof SecurityContextImpl) {
			SecurityContextImpl test = (SecurityContextImpl) obj;

			if ((this.getAuthentication() == null) && (test.getAuthentication() == null)) {
				return true;
			}

			if ((this.getAuthentication() != null) && (test.getAuthentication() != null)
					&& this.getAuthentication().equals(test.getAuthentication())) {
				return true;
			}
		}

		return false;
	}

	@Override
	public Authentication getAuthentication() {
		return authentication;
	}

	@Override
	public int hashCode() {
		if (this.authentication == null) {
			return -1;
		}
		else {
			return this.authentication.hashCode();
		}
	}

	@Override
	public void setAuthentication(Authentication authentication) {
		this.authentication = authentication;
	}

	@Override
	public String toString() {
		StringBuilder sb = new StringBuilder();
		sb.append(super.toString());

		if (this.authentication == null) {
			sb.append(": Null authentication");
		}
		else {
			sb.append(": Authentication: ").append(this.authentication);
		}

		return sb.toString();
	}
}
```
内部结构很简单，只包含了一个Authentication，代表的是认证信息。

### Authentication

它的含义可以理解成“认证信息”，也就是说从请求开始，这个认证信息可能是没有被认证的，到请求结束可能已经变成已认证了。它的状态是会变化的。让我们来看一下和Authentication相关的类图：
![Authentication](/images/Spring/Security/Authentication.png)

从上图可以看出Authentication类在整个认证类图中属于顶级接口：
``` java
package org.springframework.security.core;

import java.io.Serializable;
import java.security.Principal;
import java.util.Collection;

import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.context.SecurityContextHolder;

public interface Authentication extends Principal, Serializable {

    // 获取对应主体的权限可以是角色信息也可以是自定义的一些权限信息
	Collection<? extends GrantedAuthority> getAuthorities();

	// 主要是用户密码
	Object getCredentials();

    // 和当前认证请求相关的一些额外的信息，比如请求ip地址等
	Object getDetails();

    // 身份验证通过后设置的详细信息，例如用户名或者可以设置更为详细的用户信息
	Object getPrincipal();

    // 当前令牌是否已经认证（能够被信任），注意该值会对后续的授权产生影响，暂时不作分析
	boolean isAuthenticated();

    // 设置当前的令牌是否应该被信任，和上面的isAuthenticated()有关，再次不多做分析
	void setAuthenticated(boolean isAuthenticated) throws IllegalArgumentException;
}
```

#### Authentication类的一些实现类
从类图中可以看出具体的实现类主要有以下几种：
```
AnonymousAuthenticationToken
PreAuthenticatedAuthenticationToken
RememberMeAuthenticationToken
UsernamePasswordAuthenticationToken
...
```
常用的认证令牌有以上几种（省略的其它几种令牌），它们都继承了AbstractAuthenticationToken类，因此它们都是属于认证令牌。仔细对比这四个类可以发现它们都拥有2个构造函数，并且AnonymousAuthenticationToken和RememberMeAuthenticationToken的2个构造函数最终都调用了setAuthenticated(true)方法将当前主体设置为已认证了，而UsernamePasswordAuthenticationToken和PreAuthenticatedAuthenticationToken的第一个构造函数都把authenticated设置成了false，第二个构造函数将authenticated设置成了true。其实这四种令牌是属于两种类型的令牌：
第一类：
```
AnonymousAuthenticationToken
RememberMeAuthenticationToken
```
这一类令牌spring-security认为这是属于已认证的令牌（例如某论坛的帖子是可以匿名查看的，对应的接口就是可以匿名访问的，此时整个请求流程中的Authentication就是AnonymousAuthenticationToken）

第二类：
```
PreAuthenticatedAuthenticationToken
UsernamePasswordAuthenticationToken
```
这一类令牌是在进行认证时需要用到的令牌信息（例如，用户使用用户名和密码登录时，就会根据用户名和密码生成一个令牌，此时整个请求流程中的Authentication就是UsernamePasswordAuthenticationToken）

## 总结

1. spring-security是通过一系列的过滤器组成一个过滤链来对请求进行拦截，进而认证授权的

2. 整个请求过程中会填充一个SecurityContext对象，包含一个Authentication信息，充当认证信息

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
