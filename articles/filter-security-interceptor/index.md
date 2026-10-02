---
title: FilterSecurityInterceptor源码分析
date: 2019-06-14
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

## 核心结论

FilterSecurityInterceptor 把 HTTP 请求包装成 FilterInvocation，在调用下游过滤器链之前取得配置属性、认证信息并进行访问决策。父类还支持临时 RunAs 身份与调用后的处理；这些扩展是否实际参与，取决于配置。URL 授权和方法授权复用部分基础机制，但拦截对象不同。

## 问题与适用范围

本文回答：旧的 URL 授权过滤器在调用下游链前后执行了哪些步骤？

本文分析旧的 FilterSecurityInterceptor 与 AbstractSecurityInterceptor。下游是 Servlet 过滤器链及最终请求处理，并不意味着这里直接拦截某个带注解的业务方法；方法安全由相应的方法拦截器处理。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

FilterSecurityInterceptor是整个过滤器链中的最后一个过滤器，它的整个执行机制很复杂，这里我简单的描述一下的作用：它负责将之前过滤产生的认证信息从当前请求上下文中取出来，对请求的资源做权限判断，如果无权访问相应的资源，则抛出spring-security异常，由上一篇的ExceptionTranslationFilter进行处理。

<!-- more -->

## FilterSecurityInterceptor

```java
public class FilterSecurityInterceptor extends AbstractSecurityInterceptor implements
		Filter {

    // 是否执行过该过滤器的标记
	private static final String FILTER_APPLIED = "__spring_security_filterSecurityInterceptor_filterApplied";


	// 访问的资源元数据，默认是ExpressionBasedFilterInvocationSecurityMetadataSource
	private FilterInvocationSecurityMetadataSource securityMetadataSource;

    // 是否每次只请求一次该过滤器，例如在jsp进行转发的时候，会多次经过该过滤器，这个标记就是用来
    // 判断此时需不需要spring-security再进行一次安全检查
	private boolean observeOncePerRequest = true;

	public void init(FilterConfig arg0) throws ServletException {
	}

	public void destroy() {
	}

	// 过滤方法，实际上是new一个FilterInvocation然后委托给它执行
	public void doFilter(ServletRequest request, ServletResponse response,
			FilterChain chain) throws IOException, ServletException {
		FilterInvocation fi = new FilterInvocation(request, response, chain);
        // 核心调用
		invoke(fi);
	}

	public FilterInvocationSecurityMetadataSource getSecurityMetadataSource() {
		return this.securityMetadataSource;
	}

	public SecurityMetadataSource obtainSecurityMetadataSource() {
		return this.securityMetadataSource;
	}

	public void setSecurityMetadataSource(FilterInvocationSecurityMetadataSource newSource) {
		this.securityMetadataSource = newSource;
	}

    // 安全对象类型
	public Class<?> getSecureObjectClass() {
		return FilterInvocation.class;
	}

	public void invoke(FilterInvocation fi) throws IOException, ServletException {
        // 如果request不为空并且已经执行过该过滤器并且observeOncePerRequest = true
        // (只请求一次该过滤器)则过滤器继续往下走，不执行spring-security检查
		if ((fi.getRequest() != null)
				&& (fi.getRequest().getAttribute(FILTER_APPLIED) != null)
				&& observeOncePerRequest) {
			fi.getChain().doFilter(fi.getRequest(), fi.getResponse());
		}
		else {
			// 如果请求不为空并且只请求一次该过滤器，设置已经执行过该过滤器的标记
			if (fi.getRequest() != null && observeOncePerRequest) {
				fi.getRequest().setAttribute(FILTER_APPLIED, Boolean.TRUE);
			}

            // 安全对象调用前进行权限判断
			InterceptorStatusToken token = super.beforeInvocation(fi);

			try {
                // 过滤链继续执行
				fi.getChain().doFilter(fi.getRequest(), fi.getResponse());
			}
			finally {

                // 安全对象调用完成后，清理AbstractSecurityInterceptor的工作
				super.finallyInvocation(token);
			}

            // 安全对象调用完成后，完成AbstractSecurityInterceptor的工作。
			super.afterInvocation(token, null);
		}
	}

	public boolean isObserveOncePerRequest() {
		return observeOncePerRequest;
	}

	public void setObserveOncePerRequest(boolean observeOncePerRequest) {
		this.observeOncePerRequest = observeOncePerRequest;
	}
}

```

FilterSecurityInterceptor在进行过滤时第一步先构造一个FilterInvocation对象，然后交给父类分别在安全对象（需要保护的资源，例如某些方法需要特定的权限才能访问）调用前，调用后，和执行完毕时进行处理。下面重点分析一下父类AbstractSecurityInterceptor是如何进行处理的

## AbstractSecurityInterceptor

### beforeInvocation方法

安全方法调用前的处理逻辑

```java
// 参数object就是FilterSecurityInterceptor过滤时构造的new FilterInvocation(request, response, chain);
protected InterceptorStatusToken beforeInvocation(Object object) {
   Assert.notNull(object, "Object was null");
   final boolean debug = logger.isDebugEnabled();
   // 调用子类实现的getSecureObjectClass方法判断安全对象类型和参数类型是否一致
   // 从FilterSecurityInterceptor中我们可以发现它的安全对象类型就是FilterInvocation.class
   if (!getSecureObjectClass().isAssignableFrom(object.getClass())) {
      throw new IllegalArgumentException(
            "Security invocation attempted for object "
                  + object.getClass().getName()
                  + " but AbstractSecurityInterceptor only configured to support secure objects of type: "
                  + getSecureObjectClass());
   }

   // 从当前的安全对象（这里可以当做是http请求）获取与当前安全对象相关的配置属性
   // 例如permitAll，denyAll，anonymous，authenticated，fullyAuthenticated，rememberMe
   Collection<ConfigAttribute> attributes = this.obtainSecurityMetadataSource()
         .getAttributes(object);

   // 如果当前安全对象没有配置属性就返回null
   if (attributes == null || attributes.isEmpty()) {
      // 如果当前是拒绝公共调用的（可以理解为没有配置任何属性的请求不允许直接调用）直接抛出异常
      if (rejectPublicInvocations) {
         throw new IllegalArgumentException(
               "Secure object invocation "
                     + object
                     + " was denied as public invocations are not allowed via this interceptor. "
                     + "This indicates a configuration error because the "
                     + "rejectPublicInvocations property is set to 'true'");
      }

      if (debug) {
         logger.debug("Public object - authentication not attempted");
      }
      // 发布事件
      publishEvent(new PublicInvocationEvent(object));

      return null; // no further work post-invocation
   }

   if (debug) {
      logger.debug("Secure object: " + object + "; Attributes: " + attributes);
   }
   // 如果当前没有认证信息，在前面的匿名认证过滤器分析中我们知道，无论如何SecurityContext
   // 中都会填充认证信息的，至少也是匿名认证信息，所以此处会抛出一个
   // AuthenticationCredentialsNotFoundException异常
   if (SecurityContextHolder.getContext().getAuthentication() == null) {
      credentialsNotFound(messages.getMessage(
            "AbstractSecurityInterceptor.authenticationNotFound",
            "An Authentication object was not found in the SecurityContext"),
            object, attributes);
   }
   // 根据alwaysReauthenticate判断是否需要重新认证，如果需要重新认证则调用AuthenticationManager
   // 重新认证然后返回认证信息，否则直接返回之前的认证信息，默认是不需要重新认证的
   Authentication authenticated = authenticateIfRequired();

   // 开始进行授权判断
   try {
      // 授权是交给AccessDecisionManager来判断的
      this.accessDecisionManager.decide(authenticated, object, attributes);
   }
   catch (AccessDeniedException accessDeniedException) {
      publishEvent(new AuthorizationFailureEvent(object, attributes, authenticated,
            accessDeniedException));

      throw accessDeniedException;
   }

   if (debug) {
      logger.debug("Authorization successful");
   }

   // 是否发布授权成功事件
   if (publishAuthorizationSuccess) {
      publishEvent(new AuthorizedEvent(object, attributes, authenticated));
   }

   // 尝试重新替换掉之前的认证信息，这一步可以理解为以不同的身份进行接下来的逻辑
   Authentication runAs = this.runAsManager.buildRunAs(authenticated, object,
         attributes);

   // RunAsManager没有返回新的认证信息
   if (runAs == null) {
      if (debug) {
         logger.debug("RunAsManager did not change Authentication object");
      }

      // 返回拦截状态令牌
      return new InterceptorStatusToken(SecurityContextHolder.getContext(), false,
            attributes, object);
   }
   // RunAsManager返回了一个新的身份令牌
   else {
      if (debug) {
         logger.debug("Switching to RunAs Authentication: " + runAs);
      }
	  // 重新填充安全上下文和认证信息
      SecurityContext origCtx = SecurityContextHolder.getContext();
      SecurityContextHolder.setContext(SecurityContextHolder.createEmptyContext());
      SecurityContextHolder.getContext().setAuthentication(runAs);

      // need to revert to token.Authenticated post-invocation
      // 返回拦截状态令牌
      return new InterceptorStatusToken(origCtx, true, attributes, object);
   }
}
```

从上面的分析中我们可以发现，一共有三个很重要的步骤构成了beforeInvocation方法，它们分别是

1. 从安全对象中获取属性

   ```java
   Collection<ConfigAttribute> attributes = this.obtainSecurityMetadataSource()
               .getAttributes(object);
   ```

2. 由`AccessDecisionManager`进行权限判断

   ```java
   this.accessDecisionManager.decide(authenticated, object, attributes);
   ```

3. 由`RunAsManager`来替换掉已认证的信息

   ```java
   Authentication runAs = this.runAsManager.buildRunAs(authenticated, object,
                   attributes);
   ```

接下来我们逐一分析这三步

#### ConfigAttribute

从表面意思上我们可以猜测到，它是和安全对象相关的配置的属性。其实它就是我们在`HttpSecurity`中给特定的url设置的安全属性：permitAll，denyAll，anonymous，authenticated，fullyAuthenticated，rememberMe。从debug中我们可以发现FilterSecurityInterceptor内部维护的FilterInvocationSecurityMetadataSource是ExpressionBasedFilterInvocationSecurityMetadataSource，所以我们只需要关注它是如何从安全对象中获取配置属性即可。在它的父类DefaultFilterInvocationSecurityMetadataSource中找到了getAttributes方法

```java
public Collection<ConfigAttribute> getAttributes(Object object) {
    // 可以看到安全对象就是FilterInvocation，然后从中取出请求
    final HttpServletRequest request = ((FilterInvocation) object).getRequest();
    // 遍历内部维护的map，遍历判断RequestMatcher是否匹配当前请求，如果匹配就返回配置的属性
    for (Map.Entry<RequestMatcher, Collection<ConfigAttribute>> entry : requestMap
         .entrySet()) {
        if (entry.getKey().matches(request)) {
            return entry.getValue();
        }
    }
    return null;
}
```

从上面的代码我们可以发现是通过遍历map来返回ConfigAttribute的，并且只返回第一个匹配的结果，这也就是为什么我们再平时给url配置多个访问权限时却只有第一个生效的原因

#### AccessDecisionManager

访问决策管理器，最终判断是否有权访问特定资源的管理者，由于篇幅限制，暂时不做详细分析，以后会单独写一篇文章分析它的原理，现在我们只需要知道它的作用是对资源的访问权限进行判断就行了。

#### RunAsManager

> 仅为当前安全对象调用创建新的临时Authentication对象。
> 此接口允许实现替换仅适用于当前安全对象调用的Authentication对象。 AbstractSecurityInterceptor将仅在安全对象回调的持续时间内替换SecurityContext中保存的Authentication对象，并在回调结束时将其返回到原始Authentication对象。
> 提供这样可以建立具有两层对象的系统。一层是面向公众的，具有正常的安全方法，授权的权限预计由外部呼叫者持有。另一层是私有的，并且只能由面向公共层的对象调用。此私有层中的对象仍然需要安全性（否则它们将是公共方法），并且它们还需要安全性以防止外部调用者直接调用它们。私有层中的对象将配置为要求授予的权限永远不会授予外部调用者。 RunAsManager接口提供了一种以这种方式提升安全性的机制。
> 预计实现将提供相应的具体Authentication和AuthenticationProvider，以便可以验证替换的Authentication对象。需要实现某种形式的安全性以确保AuthenticationProvider仅接受由RunAsManager的授权具体实现创建的Authentication对象。

以上内容翻译自文档注释，我也没明白这个类的具体作用是什么，大概就是让当前的用户以另一个身份执行接下来的流程，有点系统后门的意思。它的实现类一共有两个，分别是NullRunAsManager和RunAsManagerImpl，NullRunAsManager没有任何作用，所以这里主要分析一下RunAsManagerImpl

```java
public class RunAsManagerImpl implements RunAsManager, InitializingBean {

   private String key;

   // 角色名称前缀
   private String rolePrefix = "ROLE_";

   public void afterPropertiesSet() throws Exception {
      Assert.notNull(
            key,
            "A Key is required and should match that configured for the RunAsImplAuthenticationProvider");
   }

   // 构造新的Authentication
   public Authentication buildRunAs(Authentication authentication, Object object,
         Collection<ConfigAttribute> attributes) {
      // new一个空的集合
      List<GrantedAuthority> newAuthorities = new ArrayList<>();

      // 将安全对象上配置的属性拼接角色前缀添加到newAuthorities中
      for (ConfigAttribute attribute : attributes) {
         if (this.supports(attribute)) {
            GrantedAuthority extraAuthority = new SimpleGrantedAuthority(
                  getRolePrefix() + attribute.getAttribute());
            newAuthorities.add(extraAuthority);
         }
      }

      if (newAuthorities.size() == 0) {
         return null;
      }

      // 将之前认证过的信息中已有的权限信息也添加到newAuthorities中
      newAuthorities.addAll(authentication.getAuthorities());
	  // 构造一个新的Authentication令牌
      return new RunAsUserToken(this.key, authentication.getPrincipal(),
            authentication.getCredentials(), newAuthorities,
            authentication.getClass());
   }

   public String getKey() {
      return key;
   }

   public String getRolePrefix() {
      return rolePrefix;
   }

   public void setKey(String key) {
      this.key = key;
   }

   public void setRolePrefix(String rolePrefix) {
      this.rolePrefix = rolePrefix;
   }
   // 只支持以RUN_AS_开头的配置的属性
   public boolean supports(ConfigAttribute attribute) {
      return attribute.getAttribute() != null
            && attribute.getAttribute().startsWith("RUN_AS_");
   }

   public boolean supports(Class<?> clazz) {
      return true;
   }
}
```

RunAsManagerImpl在构造新的认证令牌时，主要是在前一个的认证信息的权限基础上添加了安全对象的配置属性，并且只会添加以RUN_AS_开头的ConfigAttribute

### finallyInvocation方法

安全方法调用后始终会执行的逻辑，通过finally保证

```java
protected void finallyInvocation(InterceptorStatusToken token) {
    // beforeInvocation方法返回的InterceptorStatusToken不为空并且RunAsManager返回
    // 了新的认证结果，重新设置一下安全上下文
    if (token != null && token.isContextHolderRefreshRequired()) {
        if (logger.isDebugEnabled()) {
            logger.debug("Reverting to original Authentication: "
                         + token.getSecurityContext().getAuthentication());
        }
		// 设置上下文为原始上下文信息，即内部保存的是原始的认证信息，不是RunAsManager返回的认证信息
        SecurityContextHolder.setContext(token.getSecurityContext());
    }
}
```

如果重新设置过认证信息，即RunAsManager返回结果不为null，就重新设置一下安全上下文，注意此时的安全上下文中的认证信息是原始的认证信息，不是RunAsManager返回的认证信息。

### afterInvocation方法

安全方法调用结束的处理逻辑

```java
// 从FilterSecurityInterceptor调用处可以发现参数returnedObject始终为null
protected Object afterInvocation(InterceptorStatusToken token, Object returnedObject) {
   // 安全对象没有配置任何属性
   if (token == null) {
      // public object
      return returnedObject;
   }
   // 又再次调用了finallyInvocation方法
   finallyInvocation(token);
   // 如果配置了AfterInvocationManager，默认没有配置，所以就不作分析了
   if (afterInvocationManager != null) {
      // Attempt after invocation handling
      try {
         returnedObject = afterInvocationManager.decide(token.getSecurityContext()
               .getAuthentication(), token.getSecureObject(), token
               .getAttributes(), returnedObject);
      }
      catch (AccessDeniedException accessDeniedException) {
         AuthorizationFailureEvent event = new AuthorizationFailureEvent(
               token.getSecureObject(), token.getAttributes(), token
                     .getSecurityContext().getAuthentication(),
               accessDeniedException);
         publishEvent(event);

         throw accessDeniedException;
      }
   }

   return returnedObject;
}
```

主要是对安全方法执行完毕后的返回值进行修改，委托给AfterInvocationManager进行处理

## 总结

FilterSecurityInterceptor的整体执行逻辑已经全部解析完了，这里总结一下它的执行步骤

1. 调用父类的beforeInvocation方法，传入`new FilterInvocation(request, response, chain)`，然后返回结果为InterceptorStatusToken，真正的前置权限认证就在其中判断

2. 继续执行Servlet过滤器链及最终请求处理。这里的安全对象是FilterInvocation；对业务方法的注解授权属于方法安全拦截器的职责。

3. 调用父类的finallyInvocation方法，传入第一步返回的InterceptorStatusToken，主要是根据RunAsManager是否返回结果来还原之前的认证信息

4. 调用父类的afterInvocation方法，传入第一步返回的InterceptorStatusToken，主要是对最终返回的结果进一步处理

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
