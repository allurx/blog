---
title: SecurityRequestMatcherProviderAutoConfiguration源码分析
date: 2019-06-26
categories:
- Spring
- Spring-Security
- Spring-Security自动配置
tags:
- Spring
- Spring-Security
- Spring-Security自动配置
---

# 概述

SecurityRequestMatcherProviderAutoConfiguration的作用是自动配置一个RequestMatcherProvider，提供一个RequestMatcher

<!-- more -->

# SecurityRequestMatcherProviderAutoConfiguration

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

# 总结

SecurityRequestMatcherProviderAutoConfiguration的作用很简单就是将一个RequestMatcherProvider实例注册到spring容器中，这个RequestMatcherProvider会提供一个RequestMatcher，与spring-security一同工作

