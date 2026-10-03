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

刚加入 Spring Security 依赖，还没写用户查询代码，应用就要求登录，启动日志里还给出了一段随机密码。默认用户并没有来自数据库：Spring Boot 在应用尚未提供认证组件时，创建了一个 `InMemoryUserDetailsManager`。

接下来最容易遇到两个疑问：加了自己的用户服务，默认用户什么时候消失？加了密码编码器，配置里的明文密码会不会自动被编码？这两个问题分别由装配条件和密码处理分支回答。

本文以 **Spring Boot 2.1.5.RELEASE / Spring Security 5.1.5.RELEASE** 为准，分析 [UserDetailsServiceAutoConfiguration](https://github.com/spring-projects/spring-boot/blob/v2.1.5.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/servlet/UserDetailsServiceAutoConfiguration.java) 的条件与工厂方法。最小运行环境见[基本概念](/spring-security-basics/)。

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 先决定是否启用默认用户配置

| 条件 | 为什么需要 |
| --- | --- |
| 类路径存在 AuthenticationManager | 当前依赖具备认证基础类型 |
| 容器存在 ObjectPostProcessor | Security 的对象处理基础已接入 |
| 容器没有 AuthenticationManager、AuthenticationProvider、UserDetailsService Bean | 用户尚未通过这些入口提供自己的认证组件 |
| 工厂方法条件：没有 ClientRegistrationRepository Bean | OAuth2 客户端注册存在时，不创建这个默认内存用户 Bean |

第三行要求几类 Bean 全部缺失。因此，只注册自己的 `UserDetailsService` 就足以让这个自动配置退让，不需要再把另外两个接口也实现一遍。反过来，只编写了实现类却没有把它注册为 Bean，条件仍然满足，默认用户就会继续出现。

## 默认用户怎样被构造出来

### 属性决定用户名、密码和角色

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

### 密码分支不会自动执行 bcrypt 编码

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

例如配置中写了明文密码 `demo-password`：没有编码器 Bean、也没有 `{id}` 前缀时，工厂会保存 `{noop}demo-password`，交给委托编码器按明文方式匹配。若注册了 `BCryptPasswordEncoder`，同样的配置值会原样保留，后续 bcrypt 校验拿到的仍是普通明文，自然不符合它需要的编码格式。

所以，自定义编码器之后，要让配置密码采用该编码器接受的存储格式。编码动作由提供配置值的一方完成，这个工厂方法只决定是否补上 `{noop}`。[密码编码器与格式](/authentication-manager/)

## 从现象反查条件

如果随机密码日志消失，先看自己是否只配置了固定密码：这种情况下，内存用户依然存在，只是无需打印生成密码。如果已经注册 `UserDetailsService`，再看默认工厂是否退让，以及登录是否实际调用了自己的服务。两种情况下日志都可能消失，背后的用户来源却不同。

若目标是维护真实用户，应用应明确用户资料来源、密码存储格式和认证提供者。这个自动配置的价值在于给未自定义的开发应用提供可运行起点，其边界不应被扩大为完整账号系统。
