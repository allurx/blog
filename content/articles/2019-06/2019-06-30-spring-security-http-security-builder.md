---
title: HttpSecurity源码分析
date: 2019-06-30
id: 2019-06-30-spring-security-http-security-builder
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

## 核心结论

HttpSecurity 是构建单条 SecurityFilterChain 的构建器。配置方法添加对应的 SecurityConfigurer，在构建阶段初始化并配置这些组件，把过滤器排序后组成 DefaultSecurityFilterChain；请求匹配器决定该链适用于哪些请求。

## 问题与适用范围

本文回答：HttpSecurity 怎样把安全配置变成一条可执行的过滤器链？

本文重点是旧构建过程与 Configurer 协作关系。过滤器的具体集合由配置产生，不能把构建器里的字段或方法清单理解为每个应用都会启用的功能。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

在上一篇WebSecurityConfigurerAdapter源码分析中我们知道了HttpSecurity是如何被添加到WebSecurity中的，并且也知道HttpSecurity是用来构建securityFilterChain的，在实际项目配置中我们也一直在配置HttpSecurity，接下来我们就探索一下它是如何构建securityFilterChain。

<!-- more -->

## HttpSecurity

先来看一下它的类图

![HttpSecurity](/images/Spring/Security/HttpSecurity.png)

从上面的类图我们可以看出HttpSecurity其实也是一个SecurityBuilder，只不过它构建的对象是DefaultSecurityFilterChain而已，由于HttpSecurity的源码比较多，下面只罗列一些比较重要的代码

```java
public final class HttpSecurity extends
		AbstractConfiguredSecurityBuilder<DefaultSecurityFilterChain, HttpSecurity>
		implements SecurityBuilder<DefaultSecurityFilterChain>,
		HttpSecurityBuilder<HttpSecurity> {
    // 请求匹配者配置者
	private final RequestMatcherConfigurer requestMatcherConfigurer;
    // 组成过滤器链的一系列过滤器
	private List<Filter> filters = new ArrayList<>();
	private RequestMatcher requestMatcher = AnyRequestMatcher.INSTANCE;
    // 给过滤器排序
	private FilterComparator comparator = new FilterComparator();

	@SuppressWarnings("unchecked")
	public HttpSecurity(ObjectPostProcessor<Object> objectPostProcessor,
			AuthenticationManagerBuilder authenticationBuilder,
			Map<Class<? extends Object>, Object> sharedObjects) {
		super(objectPostProcessor);
		Assert.notNull(authenticationBuilder, "authenticationBuilder cannot be null");
		setSharedObject(AuthenticationManagerBuilder.class, authenticationBuilder);
		for (Map.Entry<Class<? extends Object>, Object> entry : sharedObjects
				.entrySet()) {
			setSharedObject((Class<Object>) entry.getKey(), entry.getValue());
		}
		ApplicationContext context = (ApplicationContext) sharedObjects
				.get(ApplicationContext.class);
		this.requestMatcherConfigurer = new RequestMatcherConfigurer(context);
	}

    // FilterSecurityInterceptor就是在ExpressionUrlAuthorizationConfigurer中创建并添加
    // 到过滤器链的
    public ExpressionUrlAuthorizationConfigurer<HttpSecurity>.ExpressionInterceptUrlRegistry authorizeRequests()
			throws Exception {
		ApplicationContext context = getContext();
		return getOrApply(new ExpressionUrlAuthorizationConfigurer<>(context))
				.getRegistry();
	}

    // 最终构建对象的方法，构建一个DefaultSecurityFilterChain
    @Override
	protected DefaultSecurityFilterChain performBuild() throws Exception {
		Collections.sort(filters, comparator);
		return new DefaultSecurityFilterChain(requestMatcher, filters);
	}



     // 添加SecurityConfigurer，平常我们配置authorizeRequests()，exceptionHandling()
     // 等方法，其实就是new了一些SecurityConfigurer的实例添加到父类
     // AbstractConfiguredSecurityBuilder内部维护的SecurityConfigurer列表中
    @SuppressWarnings("unchecked")
	private <C extends SecurityConfigurerAdapter<DefaultSecurityFilterChain, HttpSecurity>> C getOrApply(
			C configurer) throws Exception {
		C existingConfig = (C) getConfigurer(configurer.getClass());
		if (existingConfig != null) {
			return existingConfig;
		}
		return apply(configurer);
	}


}
```

## 总结

1. HttpSecurity是一个SecurityBuilder，它最终的目的是构建SecurityFilterChain
2. HttpSecurity提供了很多快捷的方法创建不同的SecurityConfigurer
3. HttpSecurity执行doBuild方法的时候通过配置的SecurityConfigurer添加一些必要的Filter，最后在执行performBuild方法将这些Filter构造成一个SecurityFilterChain

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
