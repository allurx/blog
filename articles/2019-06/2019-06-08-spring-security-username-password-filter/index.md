---
title: UsernamePasswordAuthenticationFilter源码分析
date: 2019-06-08
updated: 2026-10-01
id: 2019-06-08-spring-security-username-password-filter
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

## 核心结论

UsernamePasswordAuthenticationFilter 先用 RequestMatcher 判断请求是否属于登录处理，再提取用户名和密码构造未认证令牌，交给 AuthenticationManager。认证成功后设置安全上下文并调用成功处理器，失败则清理认证信息并调用失败处理器；过滤器本身不负责查询用户或比较密码。

## 问题与适用范围

本文回答：表单登录请求怎样从用户名密码变成认证结果？

本文分析 Servlet 表单登录，原文默认匹配 POST /login，实际路径与匹配方式可配置。JSON 登录请求需要另外处理，不能假定该过滤器会自动读取 JSON 字段。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

UsernamePasswordAuthenticationFilter顾名思义，用户名密码认证过滤器，是用来处理用户名密码登陆请求的过滤器。匹配/login请求，从请求中获取用户名和密码，然后进行认证。如果认证成功则将生成的Authentication对象放入当前线程的SecurityContext，回顾
[SecurityContextPersistenceFilter](/articles/2019-06-05-spring-security-context-persistence-filter/)中SecurityContext的生成过程，然后调用配置的AuthenticationSuccessHandler。如果认证失败则调用AuthenticationFailureHandler。

<!-- more -->

## AbstractAuthenticationProcessingFilter

首先来看一下UsernamePasswordAuthenticationFilter的父类

```java
public abstract class AbstractAuthenticationProcessingFilter extends GenericFilterBean
      implements ApplicationEventPublisherAware, MessageSourceAware {

   // 认证管理者
   private AuthenticationManager authenticationManager;

   // 记住我服务，在认证成功后调用，一般是认证成功后往响应中写入一些cookie以便浏览器能记住已登录的信息
   private RememberMeServices rememberMeServices = new NullRememberMeServices();

   // 请求匹配者，根据当前请求路径判断是否需要进行过滤
   private RequestMatcher requiresAuthenticationRequestMatcher;

   // 在认证成功后是否继续执行接下来的过滤链，默认不执行，调用相应的AuthenticationSuccessHandler
   private boolean continueChainBeforeSuccessfulAuthentication = false;

   // session认证策略，在认证成功后调用
   private SessionAuthenticationStrategy sessionStrategy = new NullAuthenticatedSessionStrategy();

   // 是否允许创建session
   private boolean allowSessionCreation = true;

   // 默认的认证成功处理器
   private AuthenticationSuccessHandler successHandler = new SavedRequestAwareAuthenticationSuccessHandler();

   // 默认的认证失败处理器
   private AuthenticationFailureHandler failureHandler = new SimpleUrlAuthenticationFailureHandler();

   // 初始化RequestMatcher
   protected AbstractAuthenticationProcessingFilter(String defaultFilterProcessesUrl) {
      setFilterProcessesUrl(defaultFilterProcessesUrl);
   }

   // 初始化RequestMatcher
   protected AbstractAuthenticationProcessingFilter(
         RequestMatcher requiresAuthenticationRequestMatcher) {
      Assert.notNull(requiresAuthenticationRequestMatcher,
            "requiresAuthenticationRequestMatcher cannot be null");
      this.requiresAuthenticationRequestMatcher = requiresAuthenticationRequestMatcher;
   }

   // 核心认证过滤方法
   public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
         throws IOException, ServletException {

      HttpServletRequest request = (HttpServletRequest) req;
      HttpServletResponse response = (HttpServletResponse) res;

      // 调用RequestMatcher判断当前请求是否需要认证
      if (!requiresAuthentication(request, response)) {
         chain.doFilter(request, response);

         return;
      }

      if (logger.isDebugEnabled()) {
         logger.debug("Request is to process authentication");
      }

      Authentication authResult;

      try {

		 // 调用子类的attemptAuthentication方法，子类实现具体的认证逻辑，然后返回
		 // Authentication对象
         authResult = attemptAuthentication方法，该方法由子类实现具体(request, response);

         // 如果返回null，立即返回，表明子类没有完成认证
         if (authResult == null) {
            return;
         }
         // 调用session认证策略进行session相关的操作，默认是NullAuthenticatedSessionStrategy,
         // 即不进行任何操作
         sessionStrategy.onAuthentication(authResult, request, response);
      }
      catch (InternalAuthenticationServiceException failed) {
         logger.error(
               "An internal error occurred while trying to authenticate the user.",
               failed);
         // 认证失败调用AuthenticationFailureHandler
         unsuccessfulAuthentication(request, response, failed);

         return;
      }
      catch (AuthenticationException failed) {
         // 认证失败调用AuthenticationFailureHandler
         unsuccessfulAuthentication(request, response, failed);

         return;
      }

      // 认证成功，是否继续走完接下来的过滤链，默认不继续过滤
      if (continueChainBeforeSuccessfulAuthentication) {
         chain.doFilter(request, response);
      }

      // 认证成功调用AuthenticationSuccessHandler
      successfulAuthentication(request, response, chain, authResult);
   }

    // 调用RequestMatcher判断当前请求是否需要认证
    protected boolean requiresAuthentication(HttpServletRequest request,
			HttpServletResponse response) {
		return requiresAuthenticationRequestMatcher.matches(request);
	}

	// 子类实现具体的认证逻辑
	public abstract Authentication attemptAuthentication(HttpServletRequest request,
			HttpServletResponse response) throws AuthenticationException, IOException,
			ServletException;

	// 认证成功时的逻辑
	protected void successfulAuthentication(HttpServletRequest request,
			HttpServletResponse response, FilterChain chain, Authentication authResult)
			throws IOException, ServletException {

		if (logger.isDebugEnabled()) {
			logger.debug("Authentication success. Updating SecurityContextHolder to contain: "
					+ authResult);
		}

		// 将当前认证成功的信息保存到当前请求线程上下文内SecurityContext中的Authentication
		SecurityContextHolder.getContext().setAuthentication(authResult);

		// 调用记住我服务，可以设置cookie信息让浏览器记住认真信息，默认是NullRememberMeServices
		// 即不作任何操作
		rememberMeServices.loginSuccess(request, response, authResult);

		// 时间发布者，发布认证成功事件
		if (this.eventPublisher != null) {
			eventPublisher.publishEvent(new InteractiveAuthenticationSuccessEvent(
					authResult, this.getClass()));
		}

		// 调用认证成功处理器进行下一步操作
		successHandler.onAuthenticationSuccess(request, response, authResult);
	}

	// 认证失败时的逻辑
	protected void unsuccessfulAuthentication(HttpServletRequest request,
			HttpServletResponse response, AuthenticationException failed)
			throws IOException, ServletException {
		// 清空当前请求上下文中的认证信息
		SecurityContextHolder.clearContext();

		if (logger.isDebugEnabled()) {
			logger.debug("Authentication request failed: " + failed.toString(), failed);
			logger.debug("Updated SecurityContextHolder to contain null Authentication");
			logger.debug("Delegating to authentication failure handler " + failureHandler);
		}

		// 调用rememberMeServices
		rememberMeServices.loginFail(request, response);

		// 调用失败处理器进行下一步操作
		failureHandler.onAuthenticationFailure(request, response, failed);
	}
}
```

### AuthenticationFailureHandler

在认证失败后，会调用AuthenticationFailureHandler进行下一步处理，默认的处理器是SimpleUrlAuthenticationFailureHandler

```java
public class SimpleUrlAuthenticationFailureHandler implements
		AuthenticationFailureHandler {

	// 认证失败后失败页面url
	private String defaultFailureUrl;

    // 是否转发到失败页面
	private boolean forwardToDestination = false;

    // 是否允许创建session
	private boolean allowSessionCreation = true;

    // 重定向策略
	private RedirectStrategy redirectStrategy = new DefaultRedirectStrategy();

	public SimpleUrlAuthenticationFailureHandler() {
	}

	public SimpleUrlAuthenticationFailureHandler(String defaultFailureUrl) {
		setDefaultFailureUrl(defaultFailureUrl);
	}

	// 认证失败处理
	public void onAuthenticationFailure(HttpServletRequest request,
			HttpServletResponse response, AuthenticationException exception)
			throws IOException, ServletException {

        // 如果没有设置认证失败页面url，设置响应骂为HttpStatus.UNAUTHORIZED
		if (defaultFailureUrl == null) {
			logger.debug("No failure URL set, sending 401 Unauthorized error");

			response.sendError(HttpStatus.UNAUTHORIZED.value(),
				HttpStatus.UNAUTHORIZED.getReasonPhrase());
		}

		else {
            // 如果设置了认证失败页面url,保存异常信息以在视图中呈现
			saveException(request, exception);

			// 如果允许转向认证失败页面，则跳转到对应页面
			if (forwardToDestination) {
				logger.debug("Forwarding to " + defaultFailureUrl);

				request.getRequestDispatcher(defaultFailureUrl)
						.forward(request, response);
			}
			else {
                // 否则调用默认的重定向策略重定向到认证失败页面
				logger.debug("Redirecting to " + defaultFailureUrl);
				redirectStrategy.sendRedirect(request, response, defaultFailureUrl);
			}
		}
	}

	// 保存异常信息
	protected final void saveException(HttpServletRequest request,
			AuthenticationException exception) {

        // 如果允许跳转认证失败页面，则将异常信息保存到请求属性中
		if (forwardToDestination) {
			request.setAttribute(WebAttributes.AUTHENTICATION_EXCEPTION, exception);
		}

        // 否则获取当前session，将异常信息保存到session中
		else {
			HttpSession session = request.getSession(false);

			if (session != null || allowSessionCreation) {
				request.getSession().setAttribute(WebAttributes.AUTHENTICATION_EXCEPTION,
						exception);
			}
		}
	}

}
```

### AuthenticationSuccessHandler

在认证成功后，会调用AuthenticationSuccessHandler进行下一步处理，默认的成功处理器是SavedRequestAwareAuthenticationSuccessHandler

```java
public class SavedRequestAwareAuthenticationSuccessHandler extends
		SimpleUrlAuthenticationSuccessHandler {

    // 请求保存缓存
	private RequestCache requestCache = new HttpSessionRequestCache();

	@Override
	public void onAuthenticationSuccess(HttpServletRequest request,
			HttpServletResponse response, Authentication authentication)
			throws ServletException, IOException {

        // 从当前请求中获取保存的请求
		SavedRequest savedRequest = requestCache.getRequest(request, response);

        // 如果没有保存的请求则调用父类认证成功方法，默认是重定向到/路径
		if (savedRequest == null) {
			super.onAuthenticationSuccess(request, response, authentication);

			return;
		}
        // 默认的重定向路径
		String targetUrlParameter = getTargetUrlParameter();
		if (isAlwaysUseDefaultTargetUrl()
				|| (targetUrlParameter != null && StringUtils.hasText(request
						.getParameter(targetUrlParameter)))) {
			requestCache.removeRequest(request, response);
			super.onAuthenticationSuccess(request, response, authentication);

			return;
		}

        // 从session清空认证失败异常
		clearAuthenticationAttributes(request);

		// 获取保存的请求中的重定向路径
		String targetUrl = savedRequest.getRedirectUrl();
		logger.debug("Redirecting to DefaultSavedRequest Url: " + targetUrl);
        // 重定向到目标路径
		getRedirectStrategy().sendRedirect(request, response, targetUrl);
	}
}
```

## UsernamePasswordAuthenticationFilter

```java
public class UsernamePasswordAuthenticationFilter extends
      AbstractAuthenticationProcessingFilter {

   // 登录的用户名字段名称
   public static final String SPRING_SECURITY_FORM_USERNAME_KEY = "username";

   // 登录的密码字段名称
   public static final String SPRING_SECURITY_FORM_PASSWORD_KEY = "password";

   private String usernameParameter = SPRING_SECURITY_FORM_USERNAME_KEY;
   private String passwordParameter = SPRING_SECURITY_FORM_PASSWORD_KEY;

   // 是否只支持post请求
   private boolean postOnly = true;

   // 初始化，指定匹配的请求路径为"/login"，方法为"POST"
   public UsernamePasswordAuthenticationFilter() {
      super(new AntPathRequestMatcher("/login", "POST"));
   }

   // 具体的认证逻辑
   public Authentication attemptAuthentication(HttpServletRequest request,
         HttpServletResponse response) throws AuthenticationException {

       // 如果仅支持post请求当时当前请求不是post则抛出认证服务异常
      if (postOnly && !request.getMethod().equals("POST")) {
         throw new AuthenticationServiceException(
               "Authentication method not supported: " + request.getMethod());
      }

      // 从当前请求中获取用户名值
      String username = obtainUsername(request);

      // 从当前请求中获取密码值
      String password = obtainPassword(request);

      if (username == null) {
         username = "";
      }

      if (password == null) {
         password = "";
      }

      username = username.trim();

      // 构造一个用户名密码认证令牌，注意这个令牌此时是未认证的
      UsernamePasswordAuthenticationToken authRequest = new UsernamePasswordAuthenticationToken(
            username, password);

      // 设置和当前请求相关的更详细的信息，例如请求ip地址等等
      setDetails(request, authRequest);

       // 注意，这一步才开始真正的认证，将UsernamePasswordAuthenticationToken委托给
       // AuthenticationManager进行认证，AuthenticationManager内部维护了一个
       // List<AuthenticationProvider>，AuthenticationProvider调用
       // boolean supports(Class<?> authentication)方法判断是否支持该令牌类型的认证
       // 进行身份认证
      return this.getAuthenticationManager().authenticate(authRequest);
   }

	// 从请求中获取密码值
   protected String obtainPassword(HttpServletRequest request) {
      return request.getParameter(passwordParameter);
   }

    // 从请求中获取用户名值
   protected String obtainUsername(HttpServletRequest request) {
      return request.getParameter(usernameParameter);
   }

   // 给认证令牌设置和当前请求相关的更为详细的信息
   protected void setDetails(HttpServletRequest request,
         UsernamePasswordAuthenticationToken authRequest) {
      authRequest.setDetails(authenticationDetailsSource.buildDetails(request));
   }

   // 重新设置用户名字段名称
   public void setUsernameParameter(String usernameParameter) {
      Assert.hasText(usernameParameter, "Username parameter must not be empty or null");
      this.usernameParameter = usernameParameter;
   }

   // 重新设置密码字段名称
   public void setPasswordParameter(String passwordParameter) {
      Assert.hasText(passwordParameter, "Password parameter must not be empty or null");
      this.passwordParameter = passwordParameter;
   }

   // 设置是否仅支持post请求
   public void setPostOnly(boolean postOnly) {
      this.postOnly = postOnly;
   }

}
```

## 总结

UsernamePasswordAuthenticationFilter的认证过程相对来说还是比较简单的

1. 根据设置的RequestMatcher判断当前请求是否需要认证
2. 如果需要认证，调用attemptAuthentication方法进行认证
3. 认证成功则将Authentication设置到SecurityContext中然后调用AuthenticationSuccessHandler处理
4. 认证失败则清空SecurityContext中的认证信息然后调用AuthenticationFailureHandler处理
5. 最终的认证处理是委托给AuthenticationManager进行认证的，它内部的认证原理将在下一篇文章中详细分析

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
