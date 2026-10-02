---
title: "Spring Security 自动配置类概述"
date: 2019-06-16
updated: 2026-10-02
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

Servlet 自动配置可以沿三条职责理解：SecurityAutoConfiguration 启用安全基础配置，UserDetailsServiceAutoConfiguration 在未提供用户或认证组件时补默认用户，SecurityFilterAutoConfiguration 将代理注册到容器；请求匹配器由相应适配配置提供。条件装配使自定义组件可以替代默认行为。

分析范围是 Servlet 自动配置；Spring Boot 2.1.5 通过 `META-INF/spring.factories` 发现这些配置类，Reactive Web 应用则使用另一组配置。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SecurityAutoConfiguration.java)。

## 概述

spring-boot-starter-security和spring其它系列的starter一样，依赖spring-boot-autoconfigure，根据其META-INF下的spring.factories加载自动配置类，然后进行一系列的初始化配置。查看spring.factories下的EnableAutoConfiguration和spring-security相关的一共有以下几种自动配置

```java
SecurityAutoConfiguration
SecurityRequestMatcherProviderAutoConfiguration
UserDetailsServiceAutoConfiguration
SecurityFilterAutoConfiguration
ReactiveSecurityAutoConfiguration
ReactiveUserDetailsServiceAutoConfiguration
```

下面对这些自动配置类进行简单的分析


## SecurityAutoConfiguration

```java
@Configuration
// 类路径下存在DefaultAuthenticationEventPublisher时才进行装配
@ConditionalOnClass(DefaultAuthenticationEventPublisher.class)
// 配置参数
@EnableConfigurationProperties(SecurityProperties.class)
// 导入SpringBootWebSecurityConfiguration，WebSecurityEnablerConfiguration和SecurityDataConfiguration配置类
@Import({ SpringBootWebSecurityConfiguration.class, WebSecurityEnablerConfiguration.class,
      SecurityDataConfiguration.class })
public class SecurityAutoConfiguration {

   @Bean
   // 容器中不存在 AuthenticationEventPublisher Bean 时才进行装配
   @ConditionalOnMissingBean(AuthenticationEventPublisher.class)
   public DefaultAuthenticationEventPublisher authenticationEventPublisher(
         ApplicationEventPublisher publisher) {
      return new DefaultAuthenticationEventPublisher(publisher);
   }

}
```

## SecurityRequestMatcherProviderAutoConfiguration

```java
@Configuration
// 类路径下存在RequestMatcher时才进行装配
@ConditionalOnClass({ RequestMatcher.class })
// 基于servlet的Web应用程序才进行装配
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityRequestMatcherProviderAutoConfiguration {

   @Configuration
   // 类路径下存在DispatcherServlet时才进行装配
   @ConditionalOnClass(DispatcherServlet.class)
   // spring容器中存在HandlerMappingIntrospector实例时才进行装配
   @ConditionalOnBean(HandlerMappingIntrospector.class)
   public static class MvcRequestMatcherConfiguration {

      @Bean
      // 类路径下存在DispatcherServlet时才进行装配
      @ConditionalOnClass(DispatcherServlet.class)
      public RequestMatcherProvider requestMatcherProvider(
            HandlerMappingIntrospector introspector) {
         return new MvcRequestMatcherProvider(introspector);
      }

   }

   @Configuration
   // 类路径下存在ResourceConfig时才进行装配
   @ConditionalOnClass(ResourceConfig.class)
   // 类路径下不存在org.springframework.web.servlet.DispatcherServlet时才进行装配
   @ConditionalOnMissingClass("org.springframework.web.servlet.DispatcherServlet")
   // spring容器中存在JerseyApplicationPath实例时才进行装配
   @ConditionalOnBean(JerseyApplicationPath.class)
   public static class JerseyRequestMatcherConfiguration {

      @Bean
      public RequestMatcherProvider requestMatcherProvider(
            JerseyApplicationPath applicationPath) {
         return new JerseyRequestMatcherProvider(applicationPath);
      }

   }

}
```

## UserDetailsServiceAutoConfiguration

```java
@Configuration
// 类路径下存在AuthenticationManager时才进行装配
@ConditionalOnClass(AuthenticationManager.class)
// spring容器中存在ObjectPostProcessor实例时才进行装配
@ConditionalOnBean(ObjectPostProcessor.class)
// spring容器中同时不存在AuthenticationManager，AuthenticationProvider，UserDetailsService实例时才进行装配
@ConditionalOnMissingBean({ AuthenticationManager.class, AuthenticationProvider.class,
      UserDetailsService.class })
public class UserDetailsServiceAutoConfiguration {

   private static final String NOOP_PASSWORD_PREFIX = "{noop}";

   private static final Pattern PASSWORD_ALGORITHM_PATTERN = Pattern
         .compile("^\\{.+}.*$");

   private static final Log logger = LogFactory
         .getLog(UserDetailsServiceAutoConfiguration.class);

   @Bean
   @ConditionalOnMissingBean(
         type = "org.springframework.security.oauth2.client.registration.ClientRegistrationRepository")
   @Lazy
   public InMemoryUserDetailsManager inMemoryUserDetailsManager(
         SecurityProperties properties,
         ObjectProvider<PasswordEncoder> passwordEncoder) {
      SecurityProperties.User user = properties.getUser();
      List<String> roles = user.getRoles();
      return new InMemoryUserDetailsManager(User.withUsername(user.getName())
            .password(getOrDeducePassword(user, passwordEncoder.getIfAvailable()))
            .roles(StringUtils.toStringArray(roles)).build());
   }

   private String getOrDeducePassword(SecurityProperties.User user,
         PasswordEncoder encoder) {
      String password = user.getPassword();
      if (user.isPasswordGenerated()) {
         logger.info(String.format("%n%nUsing generated security password: %s%n",
               user.getPassword()));
      }
      if (encoder != null || PASSWORD_ALGORITHM_PATTERN.matcher(password).matches()) {
         return password;
      }
      return NOOP_PASSWORD_PREFIX + password;
   }

}
```

## SecurityFilterAutoConfiguration

```java
@Configuration
// 基于servlet的Web应用程序才进行装配
@ConditionalOnWebApplication(type = Type.SERVLET)
// 将SecurityProperties注册为bean
@EnableConfigurationProperties(SecurityProperties.class)
// 类路径下同时存在AbstractSecurityWebApplicationInitializer，SessionCreationPolicy时才进行装配
@ConditionalOnClass({ AbstractSecurityWebApplicationInitializer.class,
      SessionCreationPolicy.class })
// 在SecurityAutoConfiguration准备后才进行装配
@AutoConfigureAfter(SecurityAutoConfiguration.class)
public class SecurityFilterAutoConfiguration {

   private static final String DEFAULT_FILTER_NAME = AbstractSecurityWebApplicationInitializer.DEFAULT_FILTER_NAME;

   @Bean
   // spring容器中存在名称为springSecurityFilterChain的实例时才进行装配
   @ConditionalOnBean(name = DEFAULT_FILTER_NAME)
   public DelegatingFilterProxyRegistrationBean securityFilterChainRegistration(
         SecurityProperties securityProperties) {
      DelegatingFilterProxyRegistrationBean registration = new DelegatingFilterProxyRegistrationBean(
            DEFAULT_FILTER_NAME);
      registration.setOrder(securityProperties.getFilter().getOrder());
      registration.setDispatcherTypes(getDispatcherTypes(securityProperties));
      return registration;
   }

   private EnumSet<DispatcherType> getDispatcherTypes(
         SecurityProperties securityProperties) {
      if (securityProperties.getFilter().getDispatcherTypes() == null) {
         return null;
      }
      return securityProperties.getFilter().getDispatcherTypes().stream()
            .map((type) -> DispatcherType.valueOf(type.name())).collect(Collectors
                  .collectingAndThen(Collectors.toSet(), EnumSet::copyOf));
   }

}
```

剩下的ReactiveSecurityAutoConfiguration和ReactiveUserDetailsServiceAutoConfiguration是spring5新增的reactive非阻塞的web框架中的配置类，不在本次的讨论之中，就不做分析了。

## 总结

本章主要分析了spring-security在项目启动时主要加载了哪些自动配置类，从spring-boot-autoconfigure的META-INF下的spring.factories文件中，我们可以发现，在项目启动时主要是加载SecurityAutoConfiguration
SecurityRequestMatcherProviderAutoConfiguration、UserDetailsServiceAutoConfiguration、
SecurityFilterAutoConfiguration这四个配置类，接下来的文章我们将围绕这四个配置类分析spring-security究竟为我们做了哪些自动配置。

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
