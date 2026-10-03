---
title: "SecurityFilterAutoConfiguration 源码分析"
date: 2019-06-27
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

SecurityFilterAutoConfiguration 注册 DelegatingFilterProxyRegistrationBean，让 Servlet 容器中的代理按 Bean 名称找到 springSecurityFilterChain，并委托其处理请求。过滤器链的构建和它在 Servlet 容器中的注册承担不同职责，顺序及 dispatcher types 由安全属性控制。

本文讨论嵌入式 Servlet 容器的 Boot 自动配置。它说明代理的注册入口，链内各过滤器怎样执行仍由 FilterChainProxy 及链内组件决定。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SecurityFilterAutoConfiguration.java)。

## 已有安全链怎样接到 Servlet 容器

这一步的前提是 Spring 容器已经能提供名为 `springSecurityFilterChain` 的 Bean。`SecurityFilterAutoConfiguration` 创建注册对象，Servlet 容器中实际注册的是 `DelegatingFilterProxy`；代理再按名称委托给 Spring 管理的安全过滤器。它连接了两个容器的生命周期，并不重新构建链内过滤器。


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

1. `@AutoConfigureAfter` 让该自动配置排序在 SecurityAutoConfiguration 之后，以便判断此前的 Bean 定义条件；这不是对所有 Bean 实例化时刻的普遍承诺。名为 `springSecurityFilterChain` 的 Bean 由前述导入链中的 WebSecurityConfiguration 构建。
2. 创建 `DelegatingFilterProxyRegistrationBean`，由它向 ServletContext 注册代理，目标 Bean 名为 `springSecurityFilterChain`。顺序和 dispatcher types 决定代理在 Servlet 请求分派中的参与方式。

## 总结

排查“安全链已创建但请求没有经过它”时，应沿注册对象、Servlet 代理、目标 Bean 这条链检查；排查“已经经过安全链但规则不生效”时，再进入 FilterChainProxy 的链选择和内部过滤器。两类问题位于不同责任边界。

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
