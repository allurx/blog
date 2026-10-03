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

在 Spring 容器里看到 `springSecurityFilterChain` Bean，并不能单凭这一点说明 HTTP 请求已经会经过它。请求首先进入 Servlet 容器，后者还需要一个已注册的 Filter 作为入口，才能把请求交给 Spring 管理的安全对象。

`SecurityFilterAutoConfiguration` 完成这一步连接：创建注册对象，让 Servlet 容器调用 `DelegatingFilterProxy`，再由代理按名称找到安全过滤入口。本文关注嵌入式 Servlet 容器中的注册路径。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SecurityFilterAutoConfiguration.java)。

## 已有安全链怎样接到 Servlet 容器

这条调用关系可以按两个容器来读：

```text
Servlet 容器收到请求
  → 已注册的 DelegatingFilterProxy
  → Spring Bean：springSecurityFilterChain
  → FilterChainProxy 选择安全链并执行其中的过滤器
```

前两步负责把请求送到正确入口，后两步才开始选择和执行安全规则。下面从注册代码看它们怎样连接。

### 注册条件要求目标 Bean 已经存在

```java
@Configuration
@ConditionalOnWebApplication(type = Type.SERVLET)
@EnableConfigurationProperties(SecurityProperties.class)
@ConditionalOnClass({ AbstractSecurityWebApplicationInitializer.class, SessionCreationPolicy.class })
@AutoConfigureAfter(SecurityAutoConfiguration.class)
public class SecurityFilterAutoConfiguration {

    // Servlet 代理按此名称查找 Spring 管理的过滤入口。
	private static final String DEFAULT_FILTER_NAME = AbstractSecurityWebApplicationInitializer.DEFAULT_FILTER_NAME;

    // 注册代理，不在此处重新构建安全过滤器链。
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

`@ConditionalOnBean(name = DEFAULT_FILTER_NAME)` 是这段代码的前提：没有对应名称的 Bean，就不会创建这个注册对象。目标 Bean 由安全配置引入的 `WebSecurityConfiguration` 构建，具体见 [SecurityAutoConfiguration 的装配过程](/security-auto-configuration/)。

`@AutoConfigureAfter` 让当前自动配置排在 `SecurityAutoConfiguration` 之后，便于判断此前的 Bean 定义。它表达的是自动配置排序，不能据此推断所有对象的实例化时刻。

### 注册顺序与分派类型决定代理何时参与

`setOrder()` 把安全属性中的顺序交给注册对象，影响它相对其他 Servlet Filter 的位置。`setDispatcherTypes()` 则限定代理参与哪些请求分派。它们都作用在 Servlet 入口这一层，并不改变 `FilterChainProxy` 内部根据请求选择安全链的规则。

例如排查转发或错误分派是否经过代理时，应查看实际 dispatcher types；排查某个 URL 进入哪条安全链时，则应继续看链匹配器。这两个判断发生在不同位置。

## 根据请求停在哪一层定位问题

排查“安全链已创建但请求没有经过它”时，应沿注册对象、Servlet 代理、目标 Bean 这条链检查；排查“已经经过安全链但规则不生效”时，再进入 FilterChainProxy 的链选择和内部过滤器。两类问题位于不同责任边界。

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
