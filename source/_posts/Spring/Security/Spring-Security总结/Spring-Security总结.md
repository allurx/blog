---
title: Spring-Security总结
date: 2019-07-04
categories:
- Spring
- Spring-Security
- Spring-Security总结
tags:
- Spring
- Spring-Security
- Spring-Security总结
---

# 概述

spring-security系列的文章总算是写完了，中途有太多的的感悟和细节还没有表达出来，还有很多东西没有涉及到，由于精力有限，手头上还有其它工作需要做，spring-security研究就暂告一段落了，但是整个主干部分目前已经理清了，现在已经可以借助spring-security保护我们的系统了，下面我们对spring-security的学习做一个总结。

<!-- more -->

# 认证

spring-security通过一个名称为**springSecurityFilterChain**的过滤器来保护我们的web安全的，这个过滤器的实际类型是**FilterChainProxy**，在这个过滤器中包含多个**SecurityFilterChain**，然后每一个**SecurityFilterChain**又包含多个**Filter**，当请求来临时，只会匹配第一个**SecurityFilterChain**，这个**SecurityFilterChain**会将这个请求挨个经过内部维护的**Filter**，我们的认证过滤器就包含在其中，最终完成认证。

# 授权

spring-security有两种授权方式，一种是**基于表达式的授权**，另一种是**基于方法注解的授权**，**基于表达式的授权**是通过**HttpSecurity的authorizeRequests()方法**进行配置的，该方法最终会将一个**FilterSecurityInterceptor**过滤器添加到**SecurityFilterChain**内部维护的过滤器列表中。**基于方法注解的授权**是通过**@EnableGlobalMethodSecurity**注解开启的，该注解最终会添加一个**MethodSecurityInterceptor**拦截器，在方法调用前检查方法上配置的权限是否和当前认证信息中的权限匹配。

# SecurityBuilder和SecurityConfigurer

1. **SecurityConfigurer**是用来给**SecurityBuilder**配置属性的，例如**HttpSecurity**的**SecurityConfigurer**有**ExpressionUrlAuthorizationConfigurer**、**ExceptionHandlingConfigurer**、**AnonymousConfigurer**等，而**WebSecurity**的**SecurityConfigurer**则是我们经常编写的继承**WebSecurityConfigurerAdapter**的类。
2. **SecurityBuilder**是用来构建安全对象的，例如**HttpSecurity**最终构建出来的是**SpringSecurityFilterChain**，而**WebSecurity**则将多个**SpringSecurityFilterChain**构建成一个**FilterChainProxy**
3. 要想知道某个**SecurityBuilder**最终构建的什么，查看对应的**performBuild**方法就明白了

# 总结

文字是枯燥的，下面给出我写的一个spring-security参考示例。开始使用spring-security保护你的web系统吧！

[**spring-security-demo**](https://github.com/Allurx/spring-security-demo)