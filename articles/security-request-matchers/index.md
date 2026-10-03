---
title: "SecurityRequestMatcherProviderAutoConfiguration 源码分析"
date: 2019-06-26
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

安全规则写下一个路径以后，还需要判断当前请求是否属于这个路径。MVC 和 Jersey 各自有请求映射的上下文，Boot 因而通过 `RequestMatcherProvider` 提供相应的匹配器适配，而不是仅凭项目里出现了 `RequestMatcher` 就选定一种实现。

这一步只回答“请求是否匹配”，匹配之后允许谁访问、怎样验证凭据，仍由其他安全组件决定。下面按条件装配过程看 MVC 与 Jersey 两个分支。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SecurityRequestMatcherProviderAutoConfiguration.java)。

## 先判断应用类型，再选择匹配器提供者

外层配置要求类路径有 `RequestMatcher`，并且当前应用是 Servlet Web 应用。通过这两项检查后，内部配置才分别判断 MVC 和 Jersey 所需的类型与 Bean：

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

### MVC 分支还需要容器里的 Introspector

`DispatcherServlet` 出现在类路径中，只满足了类条件。容器里还要存在 `HandlerMappingIntrospector` Bean，工厂方法才会得到它并创建 `MvcRequestMatcherProvider`。因此，仅增加一个 MVC 依赖，并不足以证明这个配置必定生效。

### Jersey 分支明确排除了 DispatcherServlet

Jersey 分支同时要求 `ResourceConfig` 类和 `JerseyApplicationPath` Bean，并通过 `@ConditionalOnMissingClass` 排除 `DispatcherServlet`。假设项目同时带有 MVC 与 Jersey 相关依赖，Jersey 分支也会被这个缺失类条件挡住；此后 MVC 是否生效，还要继续检查它自己的 Bean 条件。

## 用实际条件解释缺失或意外的匹配器

排查时把“类在不在”和“Bean 有没有”分开：前者来自类路径，后者来自容器装配。再检查应用是否为 Servlet 类型，就能沿源码解释某个提供者为什么出现或缺失。

提供者已经正确创建后，如果路径仍不符合预期，应继续跟踪它产生的 `RequestMatcher` 与具体请求信息；如果路径已经匹配但访问被拒绝，则转向授权规则。这样不会把匹配器装配、路径匹配和身份校验混成一个问题。

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
