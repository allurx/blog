---
title: UserDetailsServiceAutoConfiguration源码分析
date: 2019-06-26
id: 2019-06-26-spring-boot-default-user-details-service
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

## 核心结论

UserDetailsServiceAutoConfiguration 在没有自定义认证管理器、认证提供者或用户服务等条件下创建 InMemoryUserDetailsManager。默认用户属性来自 SecurityProperties，随机密码属于开发起步配置；提供自己的认证组件会使对应默认配置退让。

## 问题与适用范围

本文回答：为什么没有配置用户的 Spring Boot 安全应用也能出现默认用户名和密码？

本文分析历史默认用户配置。默认用户不属于数据库用户管理方案，日志中的密码与生成时机也不是对生产认证流程的建议；实际退让条件应按所用 Boot 版本核对。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

UserDetailsServiceAutoConfiguration的作用是在内存中配置一个用户信息管理者，通俗的讲就是自动为我们生成一个用户，就是平时我们直接启动一个spring-security项目，控制台会打印一串密码，这个密码就是自动生成的用户信息

<!-- more -->

## UserDetailsServiceAutoConfiguration

```java
@Configuration
@ConditionalOnClass(AuthenticationManager.class)
@ConditionalOnBean(ObjectPostProcessor.class)
@ConditionalOnMissingBean({ AuthenticationManager.class, AuthenticationProvider.class, UserDetailsService.class })
public class UserDetailsServiceAutoConfiguration {

	private static final String NOOP_PASSWORD_PREFIX = "{noop}";

	private static final Pattern PASSWORD_ALGORITHM_PATTERN = Pattern.compile("^\\{.+}.*$");

	private static final Log logger = LogFactory.getLog(UserDetailsServiceAutoConfiguration.class);

	@Bean
	@ConditionalOnMissingBean(
			type = "org.springframework.security.oauth2.client.registration.ClientRegistrationRepository")
	@Lazy
	public InMemoryUserDetailsManager inMemoryUserDetailsManager(SecurityProperties properties,
			ObjectProvider<PasswordEncoder> passwordEncoder) {
		SecurityProperties.User user = properties.getUser();
		List<String> roles = user.getRoles();
		return new InMemoryUserDetailsManager(
				User.withUsername(user.getName()).password(getOrDeducePassword(user, passwordEncoder.getIfAvailable()))
						.roles(StringUtils.toStringArray(roles)).build());
	}

	private String getOrDeducePassword(SecurityProperties.User user, PasswordEncoder encoder) {
		String password = user.getPassword();
		if (user.isPasswordGenerated()) {
			logger.info(String.format("%n%nUsing generated security password: %s%n", user.getPassword()));
		}
		if (encoder != null || PASSWORD_ALGORITHM_PATTERN.matcher(password).matches()) {
			return password;
		}
		return NOOP_PASSWORD_PREFIX + password;
	}

}

```

1. 判断类路径存在AuthenticationManager，**满足条件**
2. 判断spring容器中存在ObjectPostProcessor实例，在SecurityAutoConfiguration一文分析中我们知道最终容器中注册了一个AutowireBeanFactoryObjectPostProcessor，**满足条件**
3. 判断spring容器中不存在AuthenticationManager、AuthenticationProvider、UserDetailsService这三个类的实例，默认我们没有自定义这三个类，**满足条件**

综上，满足所有条件，将UserDetailsServiceAutoConfiguration实例注册到spring容器中

### InMemoryUserDetailsManager

1. 判断sprng容器中不存在org.springframework.security.oauth2.client.registration.ClientRegistrationRepository实例，我们没有依赖oauth2，**满足条件**

最终将InMemoryUserDetailsManager注册到spring容器中，InMemoryUserDetailsManager内的用户信息是自动生成的，可以发现这个user对象是在SecurityProperties中获取的

### SecurityProperties

```java
@ConfigurationProperties(prefix = "spring.security")
public class SecurityProperties {

	public static final int BASIC_AUTH_ORDER = Ordered.LOWEST_PRECEDENCE - 5;

	public static final int IGNORED_ORDER = Ordered.HIGHEST_PRECEDENCE;

	public static final int DEFAULT_FILTER_ORDER = OrderedFilter.REQUEST_WRAPPER_FILTER_MAX_ORDER - 100;
	// 直接new了一个Filter对象
	private final Filter filter = new Filter();
	// 直接new了一个User对象
	private User user = new User();

	public User getUser() {
		return this.user;
	}

	public Filter getFilter() {
		return this.filter;
	}

	public static class Filter {

		/**
		 * Security filter chain order.
		 */
		private int order = DEFAULT_FILTER_ORDER;

		/**
		 * Security filter chain dispatcher types.
		 */
		private Set<DispatcherType> dispatcherTypes = new HashSet<>(
				Arrays.asList(DispatcherType.ASYNC, DispatcherType.ERROR, DispatcherType.REQUEST));

		public int getOrder() {
			return this.order;
		}

		public void setOrder(int order) {
			this.order = order;
		}

		public Set<DispatcherType> getDispatcherTypes() {
			return this.dispatcherTypes;
		}

		public void setDispatcherTypes(Set<DispatcherType> dispatcherTypes) {
			this.dispatcherTypes = dispatcherTypes;
		}

	}

	public static class User {

		// 默认的用户名
		private String name = "user";

		// 默认的用户密码是一串uuid
		private String password = UUID.randomUUID().toString();

		// 默认的角色为空
		private List<String> roles = new ArrayList<>();
		// 默认的密码是自动生成的
		private boolean passwordGenerated = true;

		public String getName() {
			return this.name;
		}

		public void setName(String name) {
			this.name = name;
		}

		public String getPassword() {
			return this.password;
		}

		public void setPassword(String password) {
			if (!StringUtils.hasLength(password)) {
				return;
			}
			this.passwordGenerated = false;
			this.password = password;
		}

		public List<String> getRoles() {
			return this.roles;
		}

		public void setRoles(List<String> roles) {
			this.roles = new ArrayList<>(roles);
		}

		public boolean isPasswordGenerated() {
			return this.passwordGenerated;
		}

	}

}
```

默认生成的用户名是user，密码是随机的uuid，没有任何角色信息

## 总结

UserDetailsServiceAutoConfiguration自动在当前内存中配置了一个用户名为user密码为随机uuid的用户信息，密码可以在控制台找到，这是默认的配置，不过如果我们自定义了AuthenticationManager、AuthenticationProvider、UserDetailsService这三个类中的任意一个相应Bean，就会使本文展示的默认用户配置退让

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
