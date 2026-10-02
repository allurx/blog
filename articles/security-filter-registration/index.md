---
title: SecurityFilterAutoConfiguration源码分析
date: 2019-06-27
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

## 核心结论

SecurityFilterAutoConfiguration 注册 DelegatingFilterProxyRegistrationBean，让 Servlet 容器中的代理按 Bean 名称找到 springSecurityFilterChain，并委托其处理请求。过滤器链的构建和它在 Servlet 容器中的注册承担不同职责，顺序及 dispatcher types 由安全属性控制。

## 问题与适用范围

本文回答：容器中的 springSecurityFilterChain 怎样接到 Servlet 请求入口？

本文讨论嵌入式 Servlet 容器的 Boot 自动配置。它说明代理的注册入口，链内各过滤器怎样执行仍由 FilterChainProxy 及链内组件决定。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

SecurityFilterAutoConfiguration的作用是自动配置一个DelegatingFilterProxyRegistrationBean，这个bean通过name找到SecurityAutoConfiguration中往spring容器中添加名称为springSecurityFilterChain的过滤器并进行代理，最终将这个springSecurityFilterChain添加到ServletContext。

<!-- more -->

## SecurityFilterAutoConfiguration

```java
@Configuration
@ConditionalOnWebApplication(type = Type.SERVLET)
@EnableConfigurationProperties(SecurityProperties.class)
@ConditionalOnClass({ AbstractSecurityWebApplicationInitializer.class, SessionCreationPolicy.class })
@AutoConfigureAfter(SecurityAutoConfiguration.class)
public class SecurityFilterAutoConfiguration {

    // 过滤器名称springSecurityFilterChain
	private static final String DEFAULT_FILTER_NAME = AbstractSecurityWebApplicationInitializer.DEFAULT_FILTER_NAME;

    // 将DelegatingFilterProxyRegistrationBean注册到spring容器中，代理的过滤器就是
    // spring容器中的名称为springSecurityFilterChain的过滤器，这个过滤器在
    // SecurityAutoConfiguration中被注册到容器中
	@Bean
	@ConditionalOnBean(name = DEFAULT_FILTER_NAME)
	public DelegatingFilterProxyRegistrationBean securityFilterChainRegistration(
			SecurityProperties securityProperties) {
		DelegatingFilterProxyRegistrationBean registration = new DelegatingFilterProxyRegistrationBean(
				DEFAULT_FILTER_NAME);
		registration.setOrder(securityProperties.getFilter().getOrder());
		registration.setDispatcherTypes(getDispatcherTypes(securityProperties));
		return registration;
	}

	private EnumSet<DispatcherType> getDispatcherTypes(SecurityProperties securityProperties) {
		if (securityProperties.getFilter().getDispatcherTypes() == null) {
			return null;
		}
		return securityProperties.getFilter().getDispatcherTypes().stream()
				.map((type) -> DispatcherType.valueOf(type.name()))
				.collect(Collectors.collectingAndThen(Collectors.toSet(), EnumSet::copyOf));
	}

}
```

1. 在SecurityAutoConfiguration配置完成之后再进行配置，SecurityAutoConfiguration中进行了很多基本配置，其中名称为springSecurityFilterChain的bean就是在其中配置的
2. 将DelegatingFilterProxyRegistrationBean注册到spring容器中，它代理的过滤器就是springSecurityFilterChain，最终在应用启动时，会将它代理的过滤器注册到ServletContext中

## 总结

SecurityFilterAutoConfiguration将DelegatingFilterProxyRegistrationBean注册到spring容器中，委托它找到spring容器中name为springSecurityFilterChain的过滤器，在应用启动时将该过滤器添加到ServletContext中。

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
