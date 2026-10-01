---
title: AccessDecisionManager源码分析
date: 2019-06-15
id: 2019-06-15-spring-security-access-decision-manager
tags:
  - Spring
  - Spring-Security
  - Spring-Security核心过滤器
domain: Spring
---

## 核心结论

AccessDecisionManager 汇总 AccessDecisionVoter 的赞成、反对和弃权结果。AffirmativeBased 有赞成票即可允许，ConsensusBased 比较赞成与反对票数，UnanimousBased 遇到反对票即拒绝；全部弃权时仍需依据单独的配置决定，不能把弃权当作赞成。

## 问题与适用范围

本文回答：多个授权投票者意见不同时，访问决策管理器怎样做最终决定？

本文分析旧的投票式授权体系，重点是三种内置决策策略及常见投票者。配置属性的表达方式会影响投票结果，本文的策略比较不意味着它们可不加分析地相互替换。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

AccessDecisionManager访问决策管理器，制定最终访问控制（授权）决策。它的实现类有以下三种

![](/images/Spring/Security/AccessDecisionManager.png)

它们都继承了AbstractAccessDecisionManager，先来看一下它的源码

<!-- more -->

## AbstractAccessDecisionManager

```java
public abstract class AbstractAccessDecisionManager implements AccessDecisionManager,
      InitializingBean, MessageSourceAware {

   protected final Log logger = LogFactory.getLog(getClass());

   // 访问决策投票者，实际上是由这些投票者投票，然后不同的AccessDecisionManager根据投票者返回的
   // 结果授予是否允许访问
   private List<AccessDecisionVoter<? extends Object>> decisionVoters;

   protected MessageSourceAccessor messages = SpringSecurityMessageSource.getAccessor();

   // 是否允许AccessDecisionManager弃权决定，因为有可能存在投票者返回的结果不满足它们的策略。默认是
   // 不允许弃权的
   private boolean allowIfAllAbstainDecisions = false;

   protected AbstractAccessDecisionManager(
         List<AccessDecisionVoter<? extends Object>> decisionVoters) {
      Assert.notEmpty(decisionVoters, "A list of AccessDecisionVoters is required");
      this.decisionVoters = decisionVoters;
   }

   public void afterPropertiesSet() throws Exception {
      Assert.notEmpty(this.decisionVoters, "A list of AccessDecisionVoters is required");
      Assert.notNull(this.messages, "A message source must be set");
   }

   // 检查当前的AccessDecisionManager是否允许弃权，如果不允许弃权，则抛出AccessDeniedException
   protected final void checkAllowIfAllAbstainDecisions() {
      if (!this.isAllowIfAllAbstainDecisions()) {
         throw new AccessDeniedException(messages.getMessage(
               "AbstractAccessDecisionManager.accessDenied", "Access is denied"));
      }
   }

   // 返回所有投票者
   public List<AccessDecisionVoter<? extends Object>> getDecisionVoters() {
      return this.decisionVoters;
   }

   public boolean isAllowIfAllAbstainDecisions() {
      return allowIfAllAbstainDecisions;
   }

   public void setAllowIfAllAbstainDecisions(boolean allowIfAllAbstainDecisions) {
      this.allowIfAllAbstainDecisions = allowIfAllAbstainDecisions;
   }

   public void setMessageSource(MessageSource messageSource) {
      this.messages = new MessageSourceAccessor(messageSource);
   }

   public boolean supports(ConfigAttribute attribute) {
      for (AccessDecisionVoter voter : this.decisionVoters) {
         if (voter.supports(attribute)) {
            return true;
         }
      }

      return false;
   }

   public boolean supports(Class<?> clazz) {
      for (AccessDecisionVoter voter : this.decisionVoters) {
         if (!voter.supports(clazz)) {
            return false;
         }
      }

      return true;
   }
}
```

源码比较简单，主要是维护了一个AccessDecisionVoter列表，AccessDecisionVoter的作用是为AccessDecisionManager做出决定时提供依据

### <a name="AffirmativeBased决定策略">AffirmativeBased</a>

```java
public class AffirmativeBased extends AbstractAccessDecisionManager {

   public AffirmativeBased(List<AccessDecisionVoter<? extends Object>> decisionVoters) {
      super(decisionVoters);
   }

   // 决定策略
   public void decide(Authentication authentication, Object object,
         Collection<ConfigAttribute> configAttributes) throws AccessDeniedException {
      // 初始化投拒绝访问的票数为0
      int deny = 0;
	  // 遍历投票者开始投票
      for (AccessDecisionVoter voter : getDecisionVoters()) {
         // 投票
         int result = voter.vote(authentication, object, configAttributes);

         if (logger.isDebugEnabled()) {
            logger.debug("Voter: " + voter + ", returned: " + result);
         }
		 // 判断投票结果
         switch (result) {
         // 只要有一个投票者投了授权访问则停止遍历，认为允许访问
         case AccessDecisionVoter.ACCESS_GRANTED:
            return;

         case AccessDecisionVoter.ACCESS_DENIED:
            deny++;

            break;

         default:
            break;
         }
      }
	  // 只要有一个投了拒绝访问则抛出拒绝访问异常，拒绝访问
      if (deny > 0) {
         throw new AccessDeniedException(messages.getMessage(
               "AbstractAccessDecisionManager.accessDenied", "Access is denied"));
      }

      // 判断该访问决策者是否允许弃权
      checkAllowIfAllAbstainDecisions();
   }
}
```
* 只要有一个投票者投了授权访问，则授予访问权限
* 没有赞成票且至少有一个反对票时才拒绝访问；全部弃权时按 allowIfAllAbstainDecisions 决定，默认拒绝。

### <a name="ConsensusBased决定策略">ConsensusBased</a>

```java
public class ConsensusBased extends AbstractAccessDecisionManager {

   // 是否允许投授权访问和投拒绝访问的票数一致
   private boolean allowIfEqualGrantedDeniedDecisions = true;

   public ConsensusBased(List<AccessDecisionVoter<? extends Object>> decisionVoters) {
      super(decisionVoters);
   }


   // 决定策略
   public void decide(Authentication authentication, Object object,
         Collection<ConfigAttribute> configAttributes) throws AccessDeniedException {
      // 初始化投授权访问的票数为0
      int grant = 0;
      // 初始化投拒绝访问的票数为0
      int deny = 0;
	  // 遍历投票者开始投票
      for (AccessDecisionVoter voter : getDecisionVoters()) {
         // 投票
         int result = voter.vote(authentication, object, configAttributes);

         if (logger.isDebugEnabled()) {
            logger.debug("Voter: " + voter + ", returned: " + result);
         }
		 // 判断投票结果
         switch (result) {
         // 授权访问票数加一
         case AccessDecisionVoter.ACCESS_GRANTED:
            grant++;

            break;
		 // 拒绝访问票数加一
         case AccessDecisionVoter.ACCESS_DENIED:
            deny++;

            break;

         default:
            break;
         }
      }
	  // 如果授权访问票数多于拒绝访问票数则认为允许访问
      if (grant > deny) {
         return;
      }
	  // 如果拒绝访问票数多于授权访问票数则认为拒绝访问，抛出AccessDeniedException
      if (deny > grant) {
         throw new AccessDeniedException(messages.getMessage(
               "AbstractAccessDecisionManager.accessDenied", "Access is denied"));
      }
	  // 如果两种票数相等并且不为0并且允许票数相等则认为允许访问，否则认为拒绝访问，抛出
      // AccessDeniedException
      if ((grant == deny) && (grant != 0)) {
         if (this.allowIfEqualGrantedDeniedDecisions) {
            return;
         }
         else {
            throw new AccessDeniedException(messages.getMessage(
                  "AbstractAccessDecisionManager.accessDenied", "Access is denied"));
         }
      }

      // To get this far, every AccessDecisionVoter abstained
      checkAllowIfAllAbstainDecisions();
   }

   public boolean isAllowIfEqualGrantedDeniedDecisions() {
      return allowIfEqualGrantedDeniedDecisions;
   }

   public void setAllowIfEqualGrantedDeniedDecisions(
         boolean allowIfEqualGrantedDeniedDecisions) {
      this.allowIfEqualGrantedDeniedDecisions = allowIfEqualGrantedDeniedDecisions;
   }
}
```

* 授权访问票数多于拒绝访问票数则允许访问
* 拒绝访问票数多于授权访问票数则拒绝访问
* 授权访问票数和拒绝访问票数一致的情况并且不为0
  * 允许票数一致则允许访问
  * 不允许票数一致则拒绝访问

### <a name="UnanimousBased决定策略">UnanimousBased</a>

```java
public class UnanimousBased extends AbstractAccessDecisionManager {

   public UnanimousBased(List<AccessDecisionVoter<? extends Object>> decisionVoters) {
      super(decisionVoters);
   }


   // 决定策略
   public void decide(Authentication authentication, Object object,
         Collection<ConfigAttribute> attributes) throws AccessDeniedException {
	  // 初始化投授权访问的票数为0
      int grant = 0;

      List<ConfigAttribute> singleAttributeList = new ArrayList<>(1);
      singleAttributeList.add(null);
      // 遍历所有已配置的属性
      for (ConfigAttribute attribute : attributes) {
         singleAttributeList.set(0, attribute);
         // 遍历所有投票者，让每个投票者单独去给每个配置的属性投票
         for (AccessDecisionVoter voter : getDecisionVoters()) {
            int result = voter.vote(authentication, object, singleAttributeList);

            if (logger.isDebugEnabled()) {
               logger.debug("Voter: " + voter + ", returned: " + result);
            }

            switch (result) {
            // 授权访问的票数加一
            case AccessDecisionVoter.ACCESS_GRANTED:
               grant++;

               break;
            // 只要有一个投票者给其中配置的属性投了拒绝访问则认为不允许访问
            case AccessDecisionVoter.ACCESS_DENIED:
               throw new AccessDeniedException(messages.getMessage(
                     "AbstractAccessDecisionManager.accessDenied",
                     "Access is denied"));

            default:
               break;
            }
         }
      }

      // 所有投票者给所有配置的属性都投了授权访问
      if (grant > 0) {
         return;
      }

      // To get this far, every AccessDecisionVoter abstained
      checkAllowIfAllAbstainDecisions();
   }
}
```

UnanimousBased与另外两种策略的区别，还包括逐个配置属性调用投票者。假设配置属性列表直接包含ROLE_ADMIN和ROLE_DBA，而用户只有ROLE_ADMIN：RoleVoter面对整个列表时可因匹配一个角色返回赞成，AffirmativeBased于是允许访问；UnanimousBased分别对两个属性投票时，会在ROLE_DBA上得到反对票并拒绝。这个例子指的是两个独立的角色属性，不能套用于hasAnyRole这样的单个表达式属性；表达式的“或”语义由表达式自身计算。

* 把配置好的属性逐个让投票者进行投票
* 只要有一个投票者对其中的一个配置属性投了反对票则拒绝访问
* 没有反对票且至少有一张赞成票时允许访问；全部弃权时按 allowIfAllAbstainDecisions 决定。

## AccessDecisionVoter

```java
public interface AccessDecisionVoter<S> {

   // 授权访问
   int ACCESS_GRANTED = 1;
   // 弃权访问
   int ACCESS_ABSTAIN = 0;
   // 拒绝访问
   int ACCESS_DENIED = -1;

   // 判断该投票者是否能够对该安全对象配置的属性进行投票
   boolean supports(ConfigAttribute attribute);

   // 判断该投票者是否能够对该安全对象进行投票
   boolean supports(Class<?> clazz);

   // 投票
   int vote(Authentication authentication, S object,
         Collection<ConfigAttribute> attributes);
}
```

由上面的访问决策者我们可以得知，它们做出决定其实是通过投票者的投票来做出相应的决策的，在投票者内部维护的三个常量1，0，-1分别代表授权访问，弃权访问，拒绝访问，在它们投票之后会返回这些值，最终AccessDecisionManager根据这些投票者的返回这做出相应的访问策略

![](/images/Spring/Security/AccessDecisionVoterImpl.png)

常用的投票者主要有以上几种，接下来我们逐一分析它们的工作原理

### <a name="AuthenticatedVoter">AuthenticatedVoter</a>

```java
public class AuthenticatedVoter implements AccessDecisionVoter<Object> {

   // 全部已认证配置属性
   public static final String IS_AUTHENTICATED_FULLY = "IS_AUTHENTICATED_FULLY";
   // 记住我已认证配置属性
   public static final String IS_AUTHENTICATED_REMEMBERED = "IS_AUTHENTICATED_REMEMBERED";
   // 匿名已认证配置属性
   public static final String IS_AUTHENTICATED_ANONYMOUSLY = "IS_AUTHENTICATED_ANONYMOUSLY";

   // 判断当前的认证信息是那种类型或者是否已认证等等，内部逻辑很简单就不做分析了
   private AuthenticationTrustResolver authenticationTrustResolver = new AuthenticationTrustResolverImpl();

   // 是否已经全部认证的逻辑是当前认证信息不是你们用户并且不是记住我用户
   private boolean isFullyAuthenticated(Authentication authentication) {
      return (!authenticationTrustResolver.isAnonymous(authentication) && !authenticationTrustResolver
            .isRememberMe(authentication));
   }

   public void setAuthenticationTrustResolver(
         AuthenticationTrustResolver authenticationTrustResolver) {
      Assert.notNull(authenticationTrustResolver,
            "AuthenticationTrustResolver cannot be set to null");
      this.authenticationTrustResolver = authenticationTrustResolver;
   }
   // 判断是否支持该类型的配置属性，默认只支持IS_AUTHENTICATED_FULLY，
   // IS_AUTHENTICATED_REMEMBERED，IS_AUTHENTICATED_ANONYMOUSLY这三种
   public boolean supports(ConfigAttribute attribute) {
      if ((attribute.getAttribute() != null)
            && (IS_AUTHENTICATED_FULLY.equals(attribute.getAttribute())
                  || IS_AUTHENTICATED_REMEMBERED.equals(attribute.getAttribute()) || IS_AUTHENTICATED_ANONYMOUSLY
                     .equals(attribute.getAttribute()))) {
         return true;
      }
      else {
         return false;
      }
   }

   public boolean supports(Class<?> clazz) {
      return true;
   }
   // 投票逻辑
   public int vote(Authentication authentication, Object object,
         Collection<ConfigAttribute> attributes) {

      // 初始化投弃权票
      int result = ACCESS_ABSTAIN;
      // 便利所有已配置的属性
      for (ConfigAttribute attribute : attributes) {
         // 判断是否支持该配置属性
         if (this.supports(attribute)) {
            // 如果支持初始化拒绝访问
            result = ACCESS_DENIED;
            // 配置的属性是已认证，只有当前认证信息不是匿名用户和记住我用户才投授权访问
            if (IS_AUTHENTICATED_FULLY.equals(attribute.getAttribute())) {
               if (isFullyAuthenticated(authentication)) {
                  return ACCESS_GRANTED;
               }
            }
            // 配置的属性是记住我，只有当前认证信息是记住我或者是全部认证才投授权访问
            if (IS_AUTHENTICATED_REMEMBERED.equals(attribute.getAttribute())) {
               if (authenticationTrustResolver.isRememberMe(authentication)
                     || isFullyAuthenticated(authentication)) {
                  return ACCESS_GRANTED;
               }
            }
            // 配置的属性是匿名，只有当前认证信息是匿名或者是全部认证或者是记住我才投授权访问
            if (IS_AUTHENTICATED_ANONYMOUSLY.equals(attribute.getAttribute())) {
               if (authenticationTrustResolver.isAnonymous(authentication)
                     || isFullyAuthenticated(authentication)
                     || authenticationTrustResolver.isRememberMe(authentication)) {
                  return ACCESS_GRANTED;
               }
            }
         }
      }

      return result;
   }
}
```
* 配置属性是IS_AUTHENTICATED_FULLY，IS_AUTHENTICATED_REMEMBERED，IS_AUTHENTICATED_ANONYMOUSLY三者之一时才进行投票，否则投弃权票
* 配置的属性是已认证，只有当前认证信息不是匿名用户和记住我用户才投授权访问
* 配置的属性是记住我，只有当前认证信息是记住我或者是全部认证才投授权访问
* 配置的属性是匿名，只有当前认证信息是匿名或者是全部认证或者是记住我才投授权访问

### <a name="PreInvocationAuthorizationAdviceVoter">PreInvocationAuthorizationAdviceVoter</a>

```java
public class PreInvocationAuthorizationAdviceVoter implements
      AccessDecisionVoter<MethodInvocation> {
   protected final Log logger = LogFactory.getLog(getClass());
   // 在调用方法之前执行参数过滤和授权逻辑，实现类是ExpressionBasedPreInvocationAdvice，从名字可以
   // 看出这是aop的应用场景
   private final PreInvocationAuthorizationAdvice preAdvice;

   public PreInvocationAuthorizationAdviceVoter(PreInvocationAuthorizationAdvice pre) {
      this.preAdvice = pre;
   }
   // 只支持配置属性是PreInvocationAttribute类型
   public boolean supports(ConfigAttribute attribute) {
      return attribute instanceof PreInvocationAttribute;
   }
   // 支持的安全对象是方法调用
   public boolean supports(Class<?> clazz) {
      return MethodInvocation.class.isAssignableFrom(clazz);
   }

   public int vote(Authentication authentication, MethodInvocation method,
         Collection<ConfigAttribute> attributes) {
      // 从所有配置属性中找出PreInvocationAttribute类型的配置信息
      PreInvocationAttribute preAttr = findPreInvocationAttribute(attributes);
      // 如果没有PreInvocationAttribute类型的配置信息则投弃权票
      if (preAttr == null) {
         return ACCESS_ABSTAIN;
      }
      // 调用aop前置通知，具体实现在ExpressionBasedPreInvocationAdvice#before这个方法中
      boolean allowed = preAdvice.before(authentication, method, preAttr);
      // true则投授权访问，false则投拒绝访问
      return allowed ? ACCESS_GRANTED : ACCESS_DENIED;
   }

   private PreInvocationAttribute findPreInvocationAttribute(
         Collection<ConfigAttribute> config) {
      for (ConfigAttribute attribute : config) {
         if (attribute instanceof PreInvocationAttribute) {
            return (PreInvocationAttribute) attribute;
         }
      }

      return null;
   }
}
```

* 配置属性是PreInvocationAttribute类型的才进行投票，否则投弃权票
* 根据aop前置通知返回的结果进行投票
  * true投授权访问
  * false投拒绝访问

### <a name="RoleVoter">RoleVoter</a>

```java
public class RoleVoter implements AccessDecisionVoter<Object> {
   // 角色前缀
   private String rolePrefix = "ROLE_";


   public String getRolePrefix() {
      return rolePrefix;
   }

   public void setRolePrefix(String rolePrefix) {
      this.rolePrefix = rolePrefix;
   }
   // 默认只支持配置属性是以ROLE_开头，所以我们数据库中的角色设计要以ROLE_开头
   // 或者自己调用setRolePrefix改变角色前缀
   public boolean supports(ConfigAttribute attribute) {
      if ((attribute.getAttribute() != null)
            && attribute.getAttribute().startsWith(getRolePrefix())) {
         return true;
      }
      else {
         return false;
      }
   }

   public boolean supports(Class<?> clazz) {
      return true;
   }
   // 投票
   public int vote(Authentication authentication, Object object,
         Collection<ConfigAttribute> attributes) {
      if (authentication == null) {
         return ACCESS_DENIED;
      }
      // 初始化投弃权票
      int result = ACCESS_ABSTAIN;
      // 从认证信息中获取角色信息
      Collection<? extends GrantedAuthority> authorities = extractAuthorities(authentication);
      // 遍历配置的属性
      for (ConfigAttribute attribute : attributes) {
         // 判断是否支持该配置属性
         if (this.supports(attribute)) {
            // 如果支持初始化投决绝访问
            result = ACCESS_DENIED;

            // 遍历已有的角色信息
            for (GrantedAuthority authority : authorities) {
               // 只要有一项和配置的属性配置则投授权访问
               if (attribute.getAttribute().equals(authority.getAuthority())) {
                  return ACCESS_GRANTED;
               }
            }
         }
      }

      return result;
   }

   Collection<? extends GrantedAuthority> extractAuthorities(
         Authentication authentication) {
      return authentication.getAuthorities();
   }
}
```

* 配置属性是以ROLE_开头才进行投票，否则投弃权票
* 只要认证信息中有一个角色和已配置的属性匹配则投授权访问，否则投拒绝访问

### <a name="WebExpressionVoter">WebExpressionVoter</a>

```java
public class WebExpressionVoter implements AccessDecisionVoter<FilterInvocation> {
   // 表达式处理者
   private SecurityExpressionHandler<FilterInvocation> expressionHandler = new DefaultWebSecurityExpressionHandler();
   // 投票
   public int vote(Authentication authentication, FilterInvocation fi,
         Collection<ConfigAttribute> attributes) {
      assert authentication != null;
      assert fi != null;
      assert attributes != null;
      // 找出WebExpressionConfigAttribute类型的配置
      WebExpressionConfigAttribute weca = findConfigAttribute(attributes);
      // 如果没有，投弃权票
      if (weca == null) {
         return ACCESS_ABSTAIN;
      }

      // 下面这两行代码和spring表达式相关就不做分析了
      EvaluationContext ctx = expressionHandler.createEvaluationContext(authentication,
            fi);
      ctx = weca.postProcess(ctx, fi);

      // 根据表达式执行结果投票，true则投授权访问，false则投拒绝访问
      return ExpressionUtils.evaluateAsBoolean(weca.getAuthorizeExpression(), ctx) ? ACCESS_GRANTED
            : ACCESS_DENIED;
   }
   // 遍历配置的属性找出WebExpressionConfigAttribute类型的配置
   private WebExpressionConfigAttribute findConfigAttribute(
         Collection<ConfigAttribute> attributes) {
      for (ConfigAttribute attribute : attributes) {
         if (attribute instanceof WebExpressionConfigAttribute) {
            return (WebExpressionConfigAttribute) attribute;
         }
      }
      return null;
   }
   // 只支持WebExpressionConfigAttribute类型的配置属性
   public boolean supports(ConfigAttribute attribute) {
      return attribute instanceof WebExpressionConfigAttribute;
   }
   // 只支持FilterInvocation类型的安全对象
   public boolean supports(Class<?> clazz) {
      return FilterInvocation.class.isAssignableFrom(clazz);
   }

   public void setExpressionHandler(
         SecurityExpressionHandler<FilterInvocation> expressionHandler) {
      this.expressionHandler = expressionHandler;
   }
}
```

* 配置属性是WebExpressionConfigAttribute类型的才进行投票，否则投弃权票
* 根据表达式执行结果投票
  * true投授权访问
  * false投拒绝访问

## 总结

* AccessDecisionManager做出决策时是根据AccessDecisionVoter投票的结果做出决定的
* 一共有三种AccessDecisionManager，分别是AffirmativeBased，ConsensusBased和UnanimousBased。它们都会根据投票者的投票数作出自己的决定
  * <a href="#AffirmativeBased决定策略">AffirmativeBased决定策略</a>
  * <a href="#ConsensusBased决定策略">ConsensusBased决定策略</a>
  * <a href="#UnanimousBased决定策略">UnanimousBased决定策略</a>
* AccessDecisionVoter在进行投票时只会在自己支持的配置属性上进行投票
  * <a href="#AuthenticatedVoter">AuthenticatedVoter</a>
  * <a href="#PreInvocationAuthorizationAdviceVoter">PreInvocationAuthorizationAdviceVoter</a>
  * <a href="#RoleVoter">RoleVoter</a>
  * <a href="#WebExpressionVoter">WebExpressionVoter</a>

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
