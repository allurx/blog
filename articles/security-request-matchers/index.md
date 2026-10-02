---
title: "SecurityRequestMatcherProviderAutoConfiguration 源码分析"
date: 2019-06-26
updated: 2026-10-02
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

SecurityRequestMatcherProviderAutoConfiguration 根据类路径与容器中的 Bean 条件选择 RequestMatcherProvider。MVC 路径依赖 HandlerMappingIntrospector，Jersey 路径依赖 JerseyApplicationPath；它提供匹配能力，不负责执行认证或最终访问决策。

下面分析 Boot 提供的匹配器适配配置。MVC 与 Jersey 的条件并不相同，默认注册结论必须结合实际应用的 Web 框架和 Bean 条件理解。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SecurityRequestMatcherProviderAutoConfiguration.java)。

## 概述

SecurityRequestMatcherProviderAutoConfiguration的作用是自动配置一个RequestMatcherProvider，提供一个RequestMatcher


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

1. MVC 分支要求类路径存在 DispatcherServlet，且容器已经有 HandlerMappingIntrospector Bean，满足后注册 MvcRequestMatcherProvider。
2. Jersey 分支要求类路径存在 ResourceConfig、不存在 DispatcherServlet，且容器已经有 JerseyApplicationPath Bean，满足后注册 JerseyRequestMatcherProvider。两条路径由这些条件决定，并非只看项目采用了哪个框架。

## 总结

SecurityRequestMatcherProviderAutoConfiguration的作用很简单就是将一个RequestMatcherProvider实例注册到spring容器中，这个RequestMatcherProvider会提供一个RequestMatcher，与spring-security一同工作

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
