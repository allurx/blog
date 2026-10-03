---
title: "SecurityAutoConfiguration 源码分析"
date: 2019-06-17
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

引入安全 starter 后出现登录页，不是某一个自动配置类直接创建了所有过滤器。Spring Boot 先根据条件引入默认配置，Spring Security 再使用适配器和构建器生成过滤入口；认证管理器又由另一条配置链准备。

本文固定分析 **Spring Boot 2.1.5.RELEASE、Spring Security 5.1.5.RELEASE**，场景是没有自定义安全适配器的 Servlet 应用。Reactive 应用、用户提供的 Bean 或显式 @EnableWebSecurity 都可能改变入口。可运行环境见[基本概念](/spring-security-basics/)，这套旧版本用于源码研究，不是当前新项目基线。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## SecurityAutoConfiguration 只负责接入第一层配置

[SecurityAutoConfiguration 源码](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SecurityAutoConfiguration.java) 的关键声明为：

```java
@Configuration
@ConditionalOnClass(DefaultAuthenticationEventPublisher.class)
@EnableConfigurationProperties(SecurityProperties.class)
@Import({ SpringBootWebSecurityConfiguration.class, WebSecurityEnablerConfiguration.class,
        SecurityDataConfiguration.class })
```

它接入 SecurityProperties，按条件提供 DefaultAuthenticationEventPublisher，并导入其他配置。默认用户由另一自动配置负责，Servlet 代理的注册也由另一自动配置负责，不能都归到这个类的一条工厂方法里。

| 后续配置 | 在本文场景中的作用 |
| --- | --- |
| SpringBootWebSecurityConfiguration | 缺少自定义适配器时，提供默认 WebSecurityConfigurerAdapter |
| WebSecurityEnablerConfiguration | 满足条件时启用 @EnableWebSecurity |
| SecurityDataConfiguration | 与 Spring Data 安全集成有关；不承担本文的过滤器链构建主线 |

## 默认适配器与启用注解是两步

SpringBootWebSecurityConfiguration 同时要求：类路径有 WebSecurityConfigurerAdapter、容器没有该类型 Bean、当前是 Servlet Web 应用。满足后，它的内部 DefaultConfigurerAdapter 继承 WebSecurityConfigurerAdapter，不覆盖默认方法，并设置 Boot 指定的顺序。[该配置源码](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/SpringBootWebSecurityConfiguration.java)

接下来，WebSecurityEnablerConfiguration 要求容器中已有适配器、没有名为 `springSecurityFilterChain` 的 Bean，并且仍是 Servlet 应用。满足后，类上的 @EnableWebSecurity 才把 Security 自己的配置引入。[启用配置源码](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/WebSecurityEnablerConfiguration.java)

这解释了两种常见变化：提供自己的适配器会让 Boot 的默认适配器退让；显式启用 Security 时，也可以通过 Security 自身的配置链构建入口。条件判断针对 Bean 和名称，不是只检查源码里有没有写一个继承类。

## @EnableWebSecurity 把两条配置链连接起来

这个注解导入 WebSecurityConfiguration，以及 MVC/OAuth2 相关导入选择器；它本身还标记 @EnableGlobalAuthentication，后者导入 AuthenticationConfiguration。

```text
SecurityAutoConfiguration
  → 默认适配器与 WebSecurityEnablerConfiguration
  → @EnableWebSecurity
      → WebSecurityConfiguration → WebSecurity → springSecurityFilterChain
      → @EnableGlobalAuthentication → AuthenticationConfiguration
          → AuthenticationManagerBuilder、认证配置器、ObjectPostProcessor
```

图中的箭头表示配置引入或构建依赖，不表示每个名字都成为独立 Bean。ImportSelector 参与配置解析；WebSecurity 则是 WebSecurityConfiguration 内部创建并持有的构建器。

## WebSecurityConfiguration 收集适配器并生成过滤入口

它使用 AutowiredWebSecurityConfigurersIgnoreParents 查找当前 BeanFactory 的配置器，对其排序并要求 @Order 唯一，然后逐个 `webSecurity.apply(...)`。相同 order 会使启动失败，不能靠声明顺序猜测多条链的优先级。

过滤入口的 Bean 工厂方法为：

```java
public Filter springSecurityFilterChain() throws Exception {
    boolean hasConfigurers = webSecurityConfigurers != null
            && !webSecurityConfigurers.isEmpty();
    if (!hasConfigurers) {
        WebSecurityConfigurerAdapter adapter = objectObjectPostProcessor
                .postProcess(new WebSecurityConfigurerAdapter() {
                });
        webSecurity.apply(adapter);
    }
    return webSecurity.build();
}
```

没有配置器时，Security 自身还会创建一个默认适配器。`webSecurity.build()` 返回的通常是 FilterChainProxy，而不是 HttpSecurity，也不是单个 SecurityFilterChain。构建完成后，WebSecurityConfiguration 的其他工厂方法可取得表达式处理器和 WebInvocationPrivilegeEvaluator 等协作对象。[WebSecurityConfiguration 5.1.5 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/web/configuration/WebSecurityConfiguration.java)

## AuthenticationConfiguration 准备认证构建器

认证配置先导入 ObjectPostProcessorConfiguration，使手工创建的安全对象也能经过 AutowireBeanFactoryObjectPostProcessor 处理。AuthenticationManagerBuilder 的 Bean 使用延迟选择的 PasswordEncoder，并接入可用的 AuthenticationEventPublisher。

此外，InitializeUserDetailsBeanManagerConfigurer 与 InitializeAuthenticationProviderBeanManagerConfigurer 会根据已有认证组件配置全局构建器。它们参与的是认证能力的准备，与 URL 路径规则属于不同层次。

需要全局 AuthenticationManager 时，执行：

```java
public AuthenticationManager getAuthenticationManager() throws Exception {
    if (this.authenticationManagerInitialized) {
        return this.authenticationManager;
    }
    AuthenticationManagerBuilder authBuilder = authenticationManagerBuilder(
            this.objectPostProcessor, this.applicationContext);
    if (this.buildingAuthenticationManager.getAndSet(true)) {
        return new AuthenticationManagerDelegator(authBuilder);
    }

    for (GlobalAuthenticationConfigurerAdapter config : globalAuthConfigurers) {
        authBuilder.apply(config);
    }

    authenticationManager = authBuilder.build();

    if (authenticationManager == null) {
        authenticationManager = getAuthenticationManagerBean();
    }

    this.authenticationManagerInitialized = true;
    return authenticationManager;
}
```

这里可观察三个状态：尚未构建时应用全局配置器并 build；递归进入构建过程时返回 AuthenticationManagerDelegator；已经初始化后直接复用结果。若构建结果为 null，还会尝试查找已有 AuthenticationManager Bean。委托器用于处理初始化依赖，不是为每次认证都重新创建管理器。[AuthenticationConfiguration 5.1.5 源码](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/config/src/main/java/org/springframework/security/config/annotation/authentication/configuration/AuthenticationConfiguration.java)

### 密码编码器的选择也有退让关系

LazyPasswordEncoder 优先取得应用提供的 PasswordEncoder Bean；不存在时才创建 DelegatingPasswordEncoder。默认委托格式与直接 BCrypt 编码不同，详见[认证管理器中的存储格式](/authentication-manager/)。因此“有了默认用户”与“密码以什么格式校验”不能脱离 Bean 条件单独判断。

## 从启动结果回到自己的配置

| 要排查的现象 | 应追踪的入口 |
| --- | --- |
| 默认适配器为什么仍存在或消失 | SpringBootWebSecurityConfiguration 的缺失 Bean 条件 |
| 多个安全配置为什么启动失败 | 配置器排序与重复 @Order 检查 |
| 认证组件为什么没有被采用 | AuthenticationConfiguration 的全局构建和已有 Bean |
| 过滤链已经构建但请求没进入 | [Servlet 代理注册](/security-filter-registration/) |
| 请求进入了错误的安全链 | [WebSecurity 构建顺序](/web-security/)与 [FilterChainProxy 匹配](/filter-chain-proxy/) |

启动时创建对象和运行时处理请求不能混为一谈。沿上面两条配置链先确认对象从哪里来，再进入相应过滤器，才能把条件装配、自定义覆盖和实际访问结果连在一起。
