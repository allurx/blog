---
title: "UserDetailsServiceAutoConfiguration 源码分析"
date: 2019-06-26
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

一个没有自定义用户服务的 Spring Boot 安全应用也能出现登录页和默认密码，原因是条件装配提供了内存用户。要判断默认用户为何出现、何时退让，需要同时看类级条件、Bean 工厂条件和密码格式。

本文分析 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 的历史实现。源码基线是 [UserDetailsServiceAutoConfiguration](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/UserDetailsServiceAutoConfiguration.java)；最小运行环境见[基本概念](/spring-security-basics/)。默认内存用户是开发起步配置，不是数据库用户管理方案。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 先决定是否启用默认用户配置

| 条件 | 为什么需要 |
| --- | --- |
| 类路径存在 AuthenticationManager | 当前依赖具备认证基础类型 |
| 容器存在 ObjectPostProcessor | Security 的对象处理基础已接入 |
| 容器没有 AuthenticationManager、AuthenticationProvider、UserDetailsService Bean | 用户尚未通过这些入口提供自己的认证组件 |
| 工厂方法条件：没有 ClientRegistrationRepository Bean | OAuth2 客户端注册存在时，不创建这个默认内存用户 Bean |

第三行要求这几类 Bean 都缺失，并不是要求应用把三种接口全部实现后才会退让。条件检查的是实际 Bean，单纯定义一个没有注册的 Java 类不会改变结果。

## 用 SecurityProperties 构造内存用户

满足条件时，工厂方法读取 `spring.security.user` 对应属性，创建一个 InMemoryUserDetailsManager：

```java
public InMemoryUserDetailsManager inMemoryUserDetailsManager(
        SecurityProperties properties,
        ObjectProvider<PasswordEncoder> passwordEncoder) {
    SecurityProperties.User user = properties.getUser();
    List<String> roles = user.getRoles();
    return new InMemoryUserDetailsManager(User.withUsername(user.getName())
            .password(getOrDeducePassword(user, passwordEncoder.getIfAvailable()))
            .roles(StringUtils.toStringArray(roles)).build());
}
```

该版本的 SecurityProperties.User 默认值为：

| 属性 | 默认值与作用 |
| --- | --- |
| name | `user` |
| password | 初始化时生成的 UUID 字符串 |
| roles | 空列表 |
| passwordGenerated | 标记当前密码是否由默认逻辑生成 |

配置自己的 name、password 或 roles 会改变这个内存用户的资料，并不自动把持久化位置改成数据库。属性定义可对照 [SecurityProperties 2.1.5](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/SecurityProperties.java)。

## 密码是否加前缀取决于编码器配置

```java
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
```

这段代码首先在密码由框架生成时输出开发提示，然后决定是否保留原值：已有 PasswordEncoder Bean，或字符串已经带 `{id}` 格式时直接使用；两者都不满足才加 `{noop}` 前缀。它没有在这里自动把任意明文编码成 bcrypt。

因此，应用提供自定义 PasswordEncoder 时，传入的配置密码必须符合该编码器实际接受的存储格式。只添加一个 BCryptPasswordEncoder Bean，却仍把普通明文配置成 password，不能假定工厂方法会自动转换。[密码编码器与格式](/authentication-manager/)

## 从现象反查条件

默认密码日志与默认用户 Bean 是相关但不同的观察点：日志取决于密码是否自动生成，Bean 的存在取决于整组条件。自定义 UserDetailsService 后，应该确认默认工厂已退让，再观察实际认证是否走自己的服务；不能仅凭日志消失就认定数据库认证已正确。

若目标是维护真实用户，应用应明确用户资料来源、密码存储格式和认证提供者。这个自动配置的价值在于给未自定义的开发应用提供可运行起点，其边界不应被扩大为完整账号系统。
