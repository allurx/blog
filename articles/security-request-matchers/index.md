---
title: SecurityRequestMatcherProviderAutoConfiguration源码分析
date: 2019-06-26
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

## 核心结论

SecurityRequestMatcherProviderAutoConfiguration 根据类路径与容器中的 Bean 条件选择 RequestMatcherProvider。MVC 路径依赖 HandlerMappingIntrospector，Jersey 路径依赖 JerseyApplicationPath；它提供匹配能力，不负责执行认证或最终访问决策。

## 问题与适用范围

本文回答：安全自动配置怎样获得与 MVC 或 Jersey 路由相适配的请求匹配器？

本文分析历史版本中 Boot 提供的匹配器适配配置。MVC 与 Jersey 的条件并不相同，默认注册结论必须结合实际应用的 Web 框架和 Bean 条件理解。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

SecurityRequestMatcherProviderAutoConfiguration的作用是自动配置一个RequestMatcherProvider，提供一个RequestMatcher

<!-- more -->

## SecurityRequestMatcherProviderAutoConfiguration

```java
@Configuration
@ConditionalOnClass({ RequestMatcher.class })
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityRequestMatcherProviderAutoConfiguration {

	@Configuration
	@ConditionalOnClass(DispatcherServlet.class)
	@ConditionalOnBean(HandlerMappingIntrospector.class)
	public static class MvcRequestMatcherConfiguration {

		@Bean
		@ConditionalOnClass(DispatcherServlet.class)
		public RequestMatcherProvider requestMatcherProvider(HandlerMappingIntrospector introspector) {
			return new MvcRequestMatcherProvider(introspector);
		}

	}

	@Configuration
	@ConditionalOnClass(ResourceConfig.class)
	@ConditionalOnMissingClass("org.springframework.web.servlet.DispatcherServlet")
	@ConditionalOnBean(JerseyApplicationPath.class)
	public static class JerseyRequestMatcherConfiguration {

		@Bean
		public RequestMatcherProvider requestMatcherProvider(JerseyApplicationPath applicationPath) {
			return new JerseyRequestMatcherProvider(applicationPath);
		}

	}

}
```

1. 将MvcRequestMatcherProvider注册到spring容器中
2. 如果当前项目是基于jersey框架的则将JerseyRequestMatcherProvider注册到spring容器中

## 总结

SecurityRequestMatcherProviderAutoConfiguration的作用很简单就是将一个RequestMatcherProvider实例注册到spring容器中，这个RequestMatcherProvider会提供一个RequestMatcher，与spring-security一同工作

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
