---
title: AuthenticationManager源码分析
date: 2019-06-10
categories:
- Spring
- Spring-Security
- Spring-Security核心过滤器
tags:
- Spring
- Spring-Security
- Spring-Security核心过滤器
---

# 概述

本文是接着上一篇的{% post_link Spring/Security/Spring-Security核心过滤器/UsernamePasswordAuthenticationFilter %}在匹配到需要认证的请求时，内部是如何进行认证的。如果对这个过滤器不太了解，可以回头看一下它的原理。现在我们知道它最终是委托给AuthenticationManager进行认证的。从AuthenticationManager的实现类来看，它的主要实现类是ProviderManager，接下来我们着重看一下它内部的实现原理。

<!-- more -->

# ProviderManager

```java
public class ProviderManager implements AuthenticationManager, MessageSourceAware,
		InitializingBean {
	
    // 认证事件发布者
	private AuthenticationEventPublisher eventPublisher = new NullEventPublisher();
    
    // 认证提供者列表，这是对Authentication令牌进行认证的关键类
	private List<AuthenticationProvider> providers = Collections.emptyList();
    
	protected MessageSourceAccessor messages = SpringSecurityMessageSource.getAccessor();
    
    // 父类AuthenticationManager
	private AuthenticationManager parent;
            
    // 是否在验证后擦除凭据，一般是擦除密码
	private boolean eraseCredentialsAfterAuthentication = true;
    
	public ProviderManager(List<AuthenticationProvider> providers) {
		this(providers, null);
	}

	public ProviderManager(List<AuthenticationProvider> providers,
			AuthenticationManager parent) {
		Assert.notNull(providers, "providers list cannot be null");
		this.providers = providers;
		this.parent = parent;
		checkState();
	}

	// 核心认证流程
	public Authentication authenticate(Authentication authentication)
			throws AuthenticationException {
        
        // Authentication令牌class对象
		Class<? extends Authentication> toTest = authentication.getClass();
        
        // 最后一个认证异常
		AuthenticationException lastException = null;
        
        // 父类AuthenticationManager认证异常
		AuthenticationException parentException = null;
        
        // 认证结果
		Authentication result = null;
        
        // 父类AuthenticationManager认证结果
		Authentication parentResult = null;
        
		boolean debug = logger.isDebugEnabled();
		
        // 遍历AuthenticationProvider列表，尝试是否能够对Authentication令牌进行认证
		for (AuthenticationProvider provider : getProviders()) {
            
            // 不支持当前令牌认证则跳过
			if (!provider.supports(toTest)) {
				continue;
			}

			if (debug) {
				logger.debug("Authentication attempt using "
						+ provider.getClass().getName());
			}
			
            
			try {
                // AuthenticationProvider开始认证Authentication
				result = provider.authenticate(authentication);
				
                // 结果不为null则认为认证成功，然后结束遍历
				if (result != null) {
                    // 将未认证前令牌设置的请求详情设置到认证之后的令牌中
					copyDetails(authentication, result);
					break;
				}
			}
			catch (AccountStatusException e) {
				prepareException(e, authentication);
				// SEC-546: Avoid polling additional providers if auth failure is due to
				// invalid account status
				throw e;
			}
			catch (InternalAuthenticationServiceException e) {
				prepareException(e, authentication);
				throw e;
			}
			catch (AuthenticationException e) {
				lastException = e;
			}
		}
		
        // 没有认证结果，接下来让父类AuthenticationManager接着认证
		if (result == null && parent != null) {
			// Allow the parent to try.
			try {
				result = parentResult = parent.authenticate(authentication);
			}
			catch (ProviderNotFoundException e) {
				// ignore as we will throw below if no other exception occurred prior to
				// calling parent and the parent
				// may throw ProviderNotFound even though a provider in the child already
				// handled the request
			}
			catch (AuthenticationException e) {
				lastException = parentException = e;
			}
		}
		
        // 认证成功
		if (result != null) {
            
            // 擦除认证凭据，一般是将密码设置为null
			if (eraseCredentialsAfterAuthentication
					&& (result instanceof CredentialsContainer)) {
				// Authentication is complete. Remove credentials and other secret data
				// from authentication
				((CredentialsContainer) result).eraseCredentials();
			}

			// 父类AuthenticationManager如果认证成功会发布认证成功事件，避免多次发布事件
			if (parentResult == null) {
				eventPublisher.publishAuthenticationSuccess(result);
			}
            // 返回认证结果
			return result;
		}

		
		// 没有Provider能够认证令牌或者是父类为null，令lastException=ProviderNotFoundException
		if (lastException == null) {
			lastException = new ProviderNotFoundException(messages.getMessage(
					"ProviderManager.providerNotFound",
					new Object[] { toTest.getName() },
					"No AuthenticationProvider found for {0}"));
		}

		// 如果父类认证失败会发布认证失败事件，避免多次发布事件
		if (parentException == null) {
			prepareException(lastException, authentication);
		}
		
        // 最后抛出认证异常
		throw lastException;
	}
	
    // 发布认证失败事件
	@SuppressWarnings("deprecation")
	private void prepareException(AuthenticationException ex, Authentication auth) {
		eventPublisher.publishAuthenticationFailure(ex, auth);
	}

	// 将请求详情从未认证的令牌中拷贝到已认证的令牌中
	private void copyDetails(Authentication source, Authentication dest) {
		if ((dest instanceof AbstractAuthenticationToken) && (dest.getDetails() == null)) {
			AbstractAuthenticationToken token = (AbstractAuthenticationToken) dest;

			token.setDetails(source.getDetails());
		}
	}

	public List<AuthenticationProvider> getProviders() {
		return providers;
	}

	public void setMessageSource(MessageSource messageSource) {
		this.messages = new MessageSourceAccessor(messageSource);
	}

	public void setAuthenticationEventPublisher(
			AuthenticationEventPublisher eventPublisher) {
		Assert.notNull(eventPublisher, "AuthenticationEventPublisher cannot be null");
		this.eventPublisher = eventPublisher;
	}

	// 设置是否在认证成功后清除认证凭据
	public void setEraseCredentialsAfterAuthentication(boolean eraseSecretData) {
		this.eraseCredentialsAfterAuthentication = eraseSecretData;
	}

	public boolean isEraseCredentialsAfterAuthentication() {
		return eraseCredentialsAfterAuthentication;
	}

	private static final class NullEventPublisher implements AuthenticationEventPublisher {
		public void publishAuthenticationFailure(AuthenticationException exception,
				Authentication authentication) {
		}

		public void publishAuthenticationSuccess(Authentication authentication) {
		}
	}
}
```

## AuthenticationProvider

从上一步我们可以看出，ProviderManager本质是通过遍历AuthenticationProvider列表，逐个判断provider是否支持认证该Authentication，如果支持，则进行认证，否则继续下一个判断。

```java
public interface AuthenticationProvider {

	// 对未认证的令牌进行认证，然后返回已认证的令牌
	Authentication authenticate(Authentication authentication)
			throws AuthenticationException;

	// 是否支持该类型的令牌认证
	boolean supports(Class<?> authentication);
}
```

AuthenticationProvider的实现类

![](/images/Spring/Security/AuthenticationProvider.png)

AuthenticationProvider的实现类有很多，这里只列举了一些常见的实现类，这里我们着重关注一下DaoAuthenticationProvider，因为它和上一章提到的UsernamePasswordAuthenticationFilter有着千丝万缕的关系，用户名密码令牌认证就是通过这个provider进行认证的。

## AbstractUserDetailsAuthenticationProvider

先来看一下DaoAuthenticationProvider的父类

```java
public abstract class AbstractUserDetailsAuthenticationProvider implements
		AuthenticationProvider, InitializingBean, MessageSourceAware {

	protected final Log logger = LogFactory.getLog(getClass());

	protected MessageSourceAccessor messages = SpringSecurityMessageSource.getAccessor();
	
    // 用户详情缓存，默认为空
    private UserCache userCache = new NullUserCache();
    
    // 是否强制将用户主体转换为字符串
	private boolean forcePrincipalAsString = false;
    
    // 是否隐藏用户找不到异常
	protected boolean hideUserNotFoundExceptions = true;
    
    // 前置用户详情检查者，主要用来检查用户账户是否锁定，账户是否启用，账户是否过期
	private UserDetailsChecker preAuthenticationChecks = new DefaultPreAuthenticationChecks();
    
    // 后置用户详情检查者，主要用来检查用户凭据（用户密码）是否过期
	private UserDetailsChecker postAuthenticationChecks = new DefaultPostAuthenticationChecks();
    
    // 用户权限映射，主要用来获取用户的权限
	private GrantedAuthoritiesMapper authoritiesMapper = new NullAuthoritiesMapper();

	// 子类实现该方法添加额外的认证检查逻辑
	protected abstract void additionalAuthenticationChecks(UserDetails userDetails,
			UsernamePasswordAuthenticationToken authentication)
			throws AuthenticationException;

	public final void afterPropertiesSet() throws Exception {
		Assert.notNull(this.userCache, "A user cache must be set");
		Assert.notNull(this.messages, "A message source must be set");
		doAfterPropertiesSet();
	}
	
    // 核心认证逻辑
	public Authentication authenticate(Authentication authentication)
			throws AuthenticationException {
        // 该类型的provider只支持认证UsernamePasswordAuthenticationToken类型的令牌
		Assert.isInstanceOf(UsernamePasswordAuthenticationToken.class, authentication,
				() -> messages.getMessage(
						"AbstractUserDetailsAuthenticationProvider.onlySupports",
						"Only UsernamePasswordAuthenticationToken is supported"));

		// 获取用户名
		String username = (authentication.getPrincipal() == null) ? "NONE_PROVIDED"
				: authentication.getName();

		boolean cacheWasUsed = true;
        
        // 根据用户名从缓存中取出用户信息
		UserDetails user = this.userCache.getUserFromCache(username);
		
        // 缓存中没有该用户信息
		if (user == null) {
			cacheWasUsed = false;

			try {
                // 调用子类实现的retrieveUser方法来获取用户信息
				user = retrieveUser(username,
						(UsernamePasswordAuthenticationToken) authentication);
			}
			catch (UsernameNotFoundException notFound) {
				logger.debug("User '" + username + "' not found");
				
                // 因为默认是隐藏该异常，所以是捕获不到该异常的
				if (hideUserNotFoundExceptions) {
					throw new BadCredentialsException(messages.getMessage(
							"AbstractUserDetailsAuthenticationProvider.badCredentials",
							"Bad credentials"));
				}
				else {
					throw notFound;
				}
			}

			Assert.notNull(user,
					"retrieveUser returned null - a violation of the interface contract");
		}

		try {
            // 检查用户账户是否锁定，账户是否启用，账户是否过期
			preAuthenticationChecks.check(user);
            
            // 调用子类实现的additionalAuthenticationChecks方法检查用户信息，一般是比较用户名和密
            // 码是否一致
			additionalAuthenticationChecks(user,
					(UsernamePasswordAuthenticationToken) authentication);
		}
		catch (AuthenticationException exception) {
            
            // 在缓存中，找到了用户，但是该用户信息没有通过preAuthenticationChecks或者是
            // additionalAuthenticationChecks，此时，重新尝试获取用户信息
			if (cacheWasUsed) {
				// There was a problem, so try again after checking
				// we're using latest data (i.e. not from the cache)
				cacheWasUsed = false;
				user = retrieveUser(username,
						(UsernamePasswordAuthenticationToken) authentication);
				preAuthenticationChecks.check(user);
				additionalAuthenticationChecks(user,
						(UsernamePasswordAuthenticationToken) authentication);
			}
			else {
				throw exception;
			}
		}
		
        // 检查用户凭据（用户密码）是否过期
		postAuthenticationChecks.check(user);
		
        // 缓存用户信息
		if (!cacheWasUsed) {
			this.userCache.putUserInCache(user);
		}

		Object principalToReturn = user;
		
        // 是否将用户信息转换为字符串
		if (forcePrincipalAsString) {
			principalToReturn = user.getUsername();
		}
		
        // 包装认证信息
		return createSuccessAuthentication(principalToReturn, authentication, user);
	}

	// 
	protected Authentication createSuccessAuthentication(Object principal,
			Authentication authentication, UserDetails user) {
		// 重新构造已认证的令牌
		UsernamePasswordAuthenticationToken result = new UsernamePasswordAuthenticationToken(
				principal, authentication.getCredentials(),
				authoritiesMapper.mapAuthorities(user.getAuthorities()));
        
        // 给已认证的令牌设置请求详情
		result.setDetails(authentication.getDetails());

		return result;
	}

	protected void doAfterPropertiesSet() throws Exception {
	}

	public UserCache getUserCache() {
		return userCache;
	}

	public boolean isForcePrincipalAsString() {
		return forcePrincipalAsString;
	}

	public boolean isHideUserNotFoundExceptions() {
		return hideUserNotFoundExceptions;
	}

	// 子类实现该方法来获取用户详情
	protected abstract UserDetails retrieveUser(String username,
			UsernamePasswordAuthenticationToken authentication)
			throws AuthenticationException;

	public void setForcePrincipalAsString(boolean forcePrincipalAsString) {
		this.forcePrincipalAsString = forcePrincipalAsString;
	}

	// 默认情况下是隐藏用户名活密码错误的，认为具体的抛出这些异常会让客户端知道更多的信息
    // 因此构造成另一个BadCredentialsException来替换，隐藏具体细节
	public void setHideUserNotFoundExceptions(boolean hideUserNotFoundExceptions) {
		this.hideUserNotFoundExceptions = hideUserNotFoundExceptions;
	}

	public void setMessageSource(MessageSource messageSource) {
		this.messages = new MessageSourceAccessor(messageSource);
	}

	public void setUserCache(UserCache userCache) {
		this.userCache = userCache;
	}

	public boolean supports(Class<?> authentication) {
		return (UsernamePasswordAuthenticationToken.class
				.isAssignableFrom(authentication));
	}

	protected UserDetailsChecker getPreAuthenticationChecks() {
		return preAuthenticationChecks;
	}

	/**
	 * Sets the policy will be used to verify the status of the loaded
	 * <tt>UserDetails</tt> <em>before</em> validation of the credentials takes place.
	 *
	 * @param preAuthenticationChecks strategy to be invoked prior to authentication.
	 */
	public void setPreAuthenticationChecks(UserDetailsChecker preAuthenticationChecks) {
		this.preAuthenticationChecks = preAuthenticationChecks;
	}

	protected UserDetailsChecker getPostAuthenticationChecks() {
		return postAuthenticationChecks;
	}

	public void setPostAuthenticationChecks(UserDetailsChecker postAuthenticationChecks) {
		this.postAuthenticationChecks = postAuthenticationChecks;
	}

	public void setAuthoritiesMapper(GrantedAuthoritiesMapper authoritiesMapper) {
		this.authoritiesMapper = authoritiesMapper;
	}

	private class DefaultPreAuthenticationChecks implements UserDetailsChecker {
		public void check(UserDetails user) {
			if (!user.isAccountNonLocked()) {
				logger.debug("User account is locked");

				throw new LockedException(messages.getMessage(
						"AbstractUserDetailsAuthenticationProvider.locked",
						"User account is locked"));
			}

			if (!user.isEnabled()) {
				logger.debug("User account is disabled");

				throw new DisabledException(messages.getMessage(
						"AbstractUserDetailsAuthenticationProvider.disabled",
						"User is disabled"));
			}

			if (!user.isAccountNonExpired()) {
				logger.debug("User account is expired");

				throw new AccountExpiredException(messages.getMessage(
						"AbstractUserDetailsAuthenticationProvider.expired",
						"User account has expired"));
			}
		}
	}

	private class DefaultPostAuthenticationChecks implements UserDetailsChecker {
		public void check(UserDetails user) {
			if (!user.isCredentialsNonExpired()) {
				logger.debug("User account credentials have expired");

				throw new CredentialsExpiredException(messages.getMessage(
						"AbstractUserDetailsAuthenticationProvider.credentialsExpired",
						"User credentials have expired"));
			}
		}
	}
}
```

### DaoAuthenticationProvider

```java
public class DaoAuthenticationProvider extends AbstractUserDetailsAuthenticationProvider {
	private static final String USER_NOT_FOUND_PASSWORD = "userNotFoundPassword";
	
    // 密码编码器，主要用来加密和解密密码
	private PasswordEncoder passwordEncoder;

	private volatile String userNotFoundEncodedPassword;
	
    // 获取用户信息的服务类，主要用来根据用户名从数据库中获取用户信息
	private UserDetailsService userDetailsService;
	
    // 用户密码服务类，主要用来改变用户密码
	private UserDetailsPasswordService userDetailsPasswordService;
	
    // 这里初始化了一个密码编码器，默认是BCryptPasswordEncoder，也就是说，数据库中存放的用户密码
    // 需要调用BCryptPasswordEncoder的encode方法进行编码存放，否则比对的时候密码会不一致
	public DaoAuthenticationProvider() {
		setPasswordEncoder(PasswordEncoderFactories.createDelegatingPasswordEncoder());
	}

	// 实现父类的方法，添加额外的认证检查逻辑，这里主要是对比请求传递的密码和
    // 通过UserDetails中的密码是否一致
	@SuppressWarnings("deprecation")
	protected void additionalAuthenticationChecks(UserDetails userDetails,
			UsernamePasswordAuthenticationToken authentication)
			throws AuthenticationException {
        // 认证信息包含的凭据（用户密码）为null
		if (authentication.getCredentials() == null) {
			logger.debug("Authentication failed: no credentials provided");

			throw new BadCredentialsException(messages.getMessage(
					"AbstractUserDetailsAuthenticationProvider.badCredentials",
					"Bad credentials"));
		}
		
        // 获取请求传递的密码信息（明文）
		String presentedPassword = authentication.getCredentials().toString();
		
        // 将密码和UserDetails中的密码（这个UserDetails一般是根据用户名从数据库中查出来的用户信息）
        // 作比较，如果不一致则抛出异常
		if (!passwordEncoder.matches(presentedPassword, userDetails.getPassword())) {
			logger.debug("Authentication failed: password does not match stored value");

			throw new BadCredentialsException(messages.getMessage(
					"AbstractUserDetailsAuthenticationProvider.badCredentials",
					"Bad credentials"));
		}
	}

	protected void doAfterPropertiesSet() throws Exception {
		Assert.notNull(this.userDetailsService, "A UserDetailsService must be set");
	}
	
    // 根据用户名获取用户信息
	protected final UserDetails retrieveUser(String username,
			UsernamePasswordAuthenticationToken authentication)
			throws AuthenticationException {
		prepareTimingAttackProtection();
		try {
            // 调用UserDetailsService根据用户名获取用户信息，一般是自己写一个类实现
            // 该接口，然后从数据库中查出该用户名对应的用户信息
			UserDetails loadedUser = this.getUserDetailsService().loadUserByUsername(username);
            
            // 如果找不到就抛出异常
			if (loadedUser == null) {
				throw new InternalAuthenticationServiceException(
						"UserDetailsService returned null, which is an interface contract violation");
			}
            // 返回查询出来的用户信息
			return loadedUser;
		}
		catch (UsernameNotFoundException ex) {
			mitigateAgainstTimingAttack(authentication);
			throw ex;
		}
		catch (InternalAuthenticationServiceException ex) {
			throw ex;
		}
		catch (Exception ex) {
			throw new InternalAuthenticationServiceException(ex.getMessage(), ex);
		}
	}
	
    // 重写父类的方法自定义在认证成功时如何构造Authentication
	@Override
	protected Authentication createSuccessAuthentication(Object principal,
			Authentication authentication, UserDetails user) {
        // 是否重写更新用户密码
		boolean upgradeEncoding = this.userDetailsPasswordService != null
				&& this.passwordEncoder.upgradeEncoding(user.getPassword());
		if (upgradeEncoding) {
            // 用户密码（明文）
			String presentedPassword = authentication.getCredentials().toString();
			// 重新编码一次
            String newPassword = this.passwordEncoder.encode(presentedPassword);
			// 更新用户密码
            user = this.userDetailsPasswordService.updatePassword(user, newPassword);
		}
        // 调用父类方法创建认证信息
		return super.createSuccessAuthentication(principal, authentication, user);
	}

	private void prepareTimingAttackProtection() {
		if (this.userNotFoundEncodedPassword == null) {
			this.userNotFoundEncodedPassword = this.passwordEncoder.encode(USER_NOT_FOUND_PASSWORD);
		}
	}

	private void mitigateAgainstTimingAttack(UsernamePasswordAuthenticationToken authentication) {
		if (authentication.getCredentials() != null) {
			String presentedPassword = authentication.getCredentials().toString();
			this.passwordEncoder.matches(presentedPassword, this.userNotFoundEncodedPassword);
		}
	}

	// 设置密码编码器，默认是BCryptPasswordEncoder
	public void setPasswordEncoder(PasswordEncoder passwordEncoder) {
		Assert.notNull(passwordEncoder, "passwordEncoder cannot be null");
		this.passwordEncoder = passwordEncoder;
		this.userNotFoundEncodedPassword = null;
	}

	protected PasswordEncoder getPasswordEncoder() {
		return passwordEncoder;
	}

	public void setUserDetailsService(UserDetailsService userDetailsService) {
		this.userDetailsService = userDetailsService;
	}

	protected UserDetailsService getUserDetailsService() {
		return userDetailsService;
	}

	public void setUserDetailsPasswordService(
			UserDetailsPasswordService userDetailsPasswordService) {
		this.userDetailsPasswordService = userDetailsPasswordService;
	}
}

```

到这里，spring-security是如何对包含username和password的`/login`请求进行认证的主体逻辑已经全部分析完了，其实整个认证流程不算特别复杂，只是spring-security在设计的时候运用了大量的设计模式，导致我们不能够一眼看出事情的本质而已。

# 总结

1. ProviderManager内部维护了一个AuthenticationProvider列表，每个provider只会对特定类型的Authentication令牌进行认证。
2. ProviderManager在进行认证时是通过遍历AuthenticationProvider列表，只要有一个provider返回结果则认为认证成功，然后返回Authentication结果，否则抛出认证失败异常。

