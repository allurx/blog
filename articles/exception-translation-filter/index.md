---
title: "ExceptionTranslationFilter 源码分析"
date: 2019-06-13
updated: 2026-10-02
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

ExceptionTranslationFilter 将下游抛出的安全异常转换为 HTTP 处理动作。认证异常交给 AuthenticationEntryPoint；访问被拒绝时，匿名或记住我身份可能需要重新认证，完整认证的用户通常交给 AccessDeniedHandler。它负责衔接异常与响应，不执行凭据验证或权限投票。

本文分析 Servlet 过滤器链中的异常转换。具体响应可以是重定向、401 或 403，由实际配置的入口与处理器决定，正文展示的实现不能当作所有登录方式的统一默认值。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/access/ExceptionTranslationFilter.java)。

## 概述

ExceptionTranslationFilter处理过滤器链中抛出的任何AccessDeniedException和AuthenticationException，如果是AuthenticationException则调用AuthenticationEntryPoint处理，如果是AccessDeniedException并且当前的Authentication是匿名用户或者是记住我用户依旧是调用AuthenticationEntryPoint处理，否则调用AccessDeniedHandler进行处理。


## ExceptionTranslationFilter

```java
public class ExceptionTranslationFilter extends GenericFilterBean {

   // 抛出AccessDeniedException时的处理器
   private AccessDeniedHandler accessDeniedHandler = new AccessDeniedHandlerImpl();

   // 抛出AuthenticationException时的处理器
   private AuthenticationEntryPoint authenticationEntryPoint;

   // Authentication令牌解析器，主要是用来判断当前的令牌是什么类型的
   private AuthenticationTrustResolver authenticationTrustResolver = new AuthenticationTrustResolverImpl();

   // Throwable分析者，主要用来分析下游过滤器链抛出的异常
   private ThrowableAnalyzer throwableAnalyzer = new DefaultThrowableAnalyzer();

   // 请求缓存，主要是当用户未认证然后重定向到认证端点后，能够重新发起之前的请求
   private RequestCache requestCache = new HttpSessionRequestCache();

    // 消息帮助类
   private final MessageSourceAccessor messages = SpringSecurityMessageSource.getAccessor();

   public ExceptionTranslationFilter(AuthenticationEntryPoint authenticationEntryPoint) {
      this(authenticationEntryPoint, new HttpSessionRequestCache());
   }

   public ExceptionTranslationFilter(AuthenticationEntryPoint authenticationEntryPoint,
         RequestCache requestCache) {
      Assert.notNull(authenticationEntryPoint,
            "authenticationEntryPoint cannot be null");
      Assert.notNull(requestCache, "requestCache cannot be null");
      this.authenticationEntryPoint = authenticationEntryPoint;
      this.requestCache = requestCache;
   }


   @Override
   public void afterPropertiesSet() {
      Assert.notNull(authenticationEntryPoint,
            "authenticationEntryPoint must be specified");
   }

   public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
         throws IOException, ServletException {
      HttpServletRequest request = (HttpServletRequest) req;
      HttpServletResponse response = (HttpServletResponse) res;

      try {
         // 执行下游过滤器，可能会抛出Authentication或者是ExceptionAccessDeniedException
         chain.doFilter(request, response);

         logger.debug("Chain processed normally");
      }
      catch (IOException ex) {
         throw ex;
      }
      catch (Exception ex) {
         // 从堆栈跟踪中提取spring-security相关的异常
         Throwable[] causeChain = throwableAnalyzer.determineCauseChain(ex);

         // 首先尝试分析是否有AuthenticationException异常
         RuntimeException ase = (AuthenticationException) throwableAnalyzer
               .getFirstThrowableOfType(AuthenticationException.class, causeChain);

		 // 如果没有AuthenticationException异常
         if (ase == null) {

            // 尝试分析是否有AccessDeniedException异常
            ase = (AccessDeniedException) throwableAnalyzer.getFirstThrowableOfType(
                  AccessDeniedException.class, causeChain);
         }
		 // 如果有spring-security相关的异常
         if (ase != null) {

            // 此时响应已经提交了则抛出ServletException异常
            if (response.isCommitted()) {
               throw new ServletException("Unable to handle the Spring Security Exception because the response is already committed.", ex);
            }
            // 否则处理spring-security异常
            handleSpringSecurityException(request, response, chain, ase);
         }
         else {
            // Rethrow ServletExceptions and RuntimeExceptions as-is
            if (ex instanceof ServletException) {
               throw (ServletException) ex;
            }
            else if (ex instanceof RuntimeException) {
               throw (RuntimeException) ex;
            }

            // Wrap other Exceptions. This shouldn't actually happen
            // as we've already covered all the possibilities for doFilter
            throw new RuntimeException(ex);
         }
      }
   }

   public AuthenticationEntryPoint getAuthenticationEntryPoint() {
      return authenticationEntryPoint;
   }

   protected AuthenticationTrustResolver getAuthenticationTrustResolver() {
      return authenticationTrustResolver;
   }

   // 处理spring-security异常逻辑
   private void handleSpringSecurityException(HttpServletRequest request,
         HttpServletResponse response, FilterChain chain, RuntimeException exception)
         throws IOException, ServletException {

      // 如果是AuthenticationException异常
      if (exception instanceof AuthenticationException) {
         logger.debug(
               "Authentication exception occurred; redirecting to authentication entry point",
               exception);
		 // 准备调用AuthenticationEntryPoint进行处理
         sendStartAuthentication(request, response, chain,
               (AuthenticationException) exception);
      }

      // 如果异常是AccessDeniedException
      else if (exception instanceof AccessDeniedException) {
         Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

         // 并且当前的认证信息是匿名令牌或者记住我令牌依旧调用AuthenticationEntryPoint进行处理
         // 可能spring-scurity作者认为这种用户是需要认证的吧
         if (authenticationTrustResolver.isAnonymous(authentication) || authenticationTrustResolver.isRememberMe(authentication)) {
            logger.debug(
                  "Access is denied (user is " + (authenticationTrustResolver.isAnonymous(authentication) ? "anonymous" : "not fully authenticated") + "); redirecting to authentication entry point",
                  exception);

            sendStartAuthentication(
                  request,
                  response,
                  chain,
                  new InsufficientAuthenticationException(
                     messages.getMessage(
                        "ExceptionTranslationFilter.insufficientAuthentication",
                        "Full authentication is required to access this resource")));
         }

         // 否则的话就调用AccessDeniedHandler进行处理
         else {
            logger.debug(
                  "Access is denied (user is not anonymous); delegating to AccessDeniedHandler",
                  exception);

            accessDeniedHandler.handle(request, response,
                  (AccessDeniedException) exception);
         }
      }
   }

   // 调用AuthenticationEntryPoint处理逻辑
   protected void sendStartAuthentication(HttpServletRequest request,
         HttpServletResponse response, FilterChain chain,
         AuthenticationException reason) throws ServletException, IOException {
      // 清空之前的认证信息
      SecurityContextHolder.getContext().setAuthentication(null);
      // 保存这一次请求，以便接下来认证成功能够再次调用该请求
      requestCache.saveRequest(request, response);
      logger.debug("Calling Authentication entry point.");
      // 开始处理
      authenticationEntryPoint.commence(request, response, reason);
   }

   public void setAccessDeniedHandler(AccessDeniedHandler accessDeniedHandler) {
      Assert.notNull(accessDeniedHandler, "AccessDeniedHandler required");
      this.accessDeniedHandler = accessDeniedHandler;
   }

   public void setAuthenticationTrustResolver(
         AuthenticationTrustResolver authenticationTrustResolver) {
      Assert.notNull(authenticationTrustResolver,
            "authenticationTrustResolver must not be null");
      this.authenticationTrustResolver = authenticationTrustResolver;
   }

   public void setThrowableAnalyzer(ThrowableAnalyzer throwableAnalyzer) {
      Assert.notNull(throwableAnalyzer, "throwableAnalyzer must not be null");
      this.throwableAnalyzer = throwableAnalyzer;
   }

   /**
    * Default implementation of <code>ThrowableAnalyzer</code> which is capable of also
    * unwrapping <code>ServletException</code>s.
    */
   private static final class DefaultThrowableAnalyzer extends ThrowableAnalyzer {
      /**
       * @see org.springframework.security.web.util.ThrowableAnalyzer#initExtractorMap()
       */
      protected void initExtractorMap() {
         super.initExtractorMap();

         registerExtractor(ServletException.class, new ThrowableCauseExtractor() {
            public Throwable extractCause(Throwable throwable) {
               ThrowableAnalyzer.verifyThrowableHierarchy(throwable,
                     ServletException.class);
               return ((ServletException) throwable).getRootCause();
            }
         });
      }

   }

}
```

下面以 Http403ForbiddenEntryPoint 和 AccessDeniedHandlerImpl 为例说明响应处理。AuthenticationEntryPoint 由认证方式和配置决定，例如表单登录使用的入口会引导用户访问登录页。

### Http403ForbiddenEntryPoint

```java
public class Http403ForbiddenEntryPoint implements AuthenticationEntryPoint {
   private static final Log logger = LogFactory.getLog(Http403ForbiddenEntryPoint.class);

   /**
    * Always returns a 403 error code to the client.
    */
   public void commence(HttpServletRequest request, HttpServletResponse response,
         AuthenticationException arg2) throws IOException, ServletException {
      if (logger.isDebugEnabled()) {
         logger.debug("Pre-authenticated entry point called. Rejecting access");
      }
      response.sendError(HttpServletResponse.SC_FORBIDDEN, "Access Denied");
   }
}
```

很简单，直接发送了403响应码

### AccessDeniedHandlerImpl

```java
public class AccessDeniedHandlerImpl implements AccessDeniedHandler {

   protected static final Log logger = LogFactory.getLog(AccessDeniedHandlerImpl.class);

   // 错误页url
   private String errorPage;

   public void handle(HttpServletRequest request, HttpServletResponse response,
         AccessDeniedException accessDeniedException) throws IOException,
         ServletException {
      // 响应未提交
      if (!response.isCommitted()) {
         // 已经设置了错误页url
         if (errorPage != null) {
            // 将异常放入请求范围（可能用于视图）
            request.setAttribute(WebAttributes.ACCESS_DENIED_403,
                  accessDeniedException);

            // 设置403响应码
            response.setStatus(HttpStatus.FORBIDDEN.value());

            // 在服务端转发到错误页
            RequestDispatcher dispatcher = request.getRequestDispatcher(errorPage);
            dispatcher.forward(request, response);
         }
         // 如果没有设置错误页，设置403响应码
         else {
            response.sendError(HttpStatus.FORBIDDEN.value(),
               HttpStatus.FORBIDDEN.getReasonPhrase());
         }
      }
   }

   // 设置错误页url
   public void setErrorPage(String errorPage) {
      if ((errorPage != null) && !errorPage.startsWith("/")) {
         throw new IllegalArgumentException("errorPage must begin with '/'");
      }

      this.errorPage = errorPage;
   }
}
```

响应尚未提交时，AccessDeniedHandlerImpl 先设置 403 状态，再通过 RequestDispatcher.forward() 在服务端转发到配置的错误页；没有错误页时直接调用 sendError(403)。这里没有向浏览器发送重定向。

## 总结

1. 解析下游过滤器抛出的异常
2. 如果是AuthenticationException则调AuthenticationEntryPoint处理
3. 如果是AccessDeniedException并且当前的Authentication是匿名用户或者是记住我用户依旧是调用AuthenticationEntryPoint处理，否则调用AccessDeniedHandler进行处理
4. 本文展示了Http403ForbiddenEntryPoint和AccessDeniedHandlerImpl。实际使用的入口及拒绝处理器由配置决定，例如表单登录通常需要登录页入口。

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
