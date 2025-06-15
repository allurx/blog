---
title: SecurityContextPersistenceFilter源码分析
date: 2019-06-05
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

SecurityContextPersistenceFilter在整个过滤器链中排在了第二的位置，由此可见该过滤器的重要性，并且从该过滤器的名字大概可以看出它主要作用是持久化SecurityContext（安全上下文信息），即将整个安全相关的信息保存起来，这样下游的其它过滤器就可以使用这个安全信息进行相关的操作了。

<!-- more -->

# SecurityContextRepository

既然要将SecurityContext保存起来，那么就需要一个保存的地方，那这个保存的地方是什么呢？我们先来看一下SecurityContextPersistenceFilter类：
``` java
public class SecurityContextPersistenceFilter extends GenericFilterBean {

    // 是否执行过该过滤器的标记
	static final String FILTER_APPLIED = "__spring_security_scpf_applied";
    
    // 安全上下文保存仓库
	private SecurityContextRepository repo;

    // 是否需要优先创建session
	private boolean forceEagerSessionCreation = false;

	...省略内部其它方法
}
```
从上面可以看出SecurityContextPersistenceFilter内部维护了一个SecurityContextRepository，这个类就是初始化SecurityContext的地方：
![](/images/Spring/Security/SecurityContextRepository.png)
一共有2个类实现了该接口，其中NullSecurityContextRepository没有太大的意义，代表这是一个空的安全上下文仓库，我们这里主要关注HttpSessionSecurityContextRepository，这是SecurityContextPersistenceFilter内部默认的安全上下文仓库。

``` java
public class SecurityContextPersistenceFilter extends GenericFilterBean {

    public SecurityContextPersistenceFilter() {
    	this(new HttpSessionSecurityContextRepository());
    }

	public SecurityContextPersistenceFilter(SecurityContextRepository repo) {
		this.repo = repo;
	}
    ...省略部分代码
}
```
SecurityContextPersistenceFilter的默认的构造函数使用的就是HttpSessionSecurityContextRepository。接下来我们继续查看HttpSessionSecurityContextRepository这个类：
``` java
public class HttpSessionSecurityContextRepository implements SecurityContextRepository {

    // 存放在HttpSession中的key
	public static final String SPRING_SECURITY_CONTEXT_KEY = "SPRING_SECURITY_CONTEXT";
	
	// 是否允许创建session
	private boolean allowSessionCreation = true;
	
	private String springSecurityContextKey = SPRING_SECURITY_CONTEXT_KEY;

    // 从当前请求中获取SecurityContext，HttpRequestResponseHolder这个类只是简单的对
    // HttpServletRequest和HttpServletResponse进行了一层包装
	public SecurityContext loadContext(HttpRequestResponseHolder requestResponseHolder) {
		HttpServletRequest request = requestResponseHolder.getRequest();
		HttpServletResponse response = requestResponseHolder.getResponse();
		HttpSession httpSession = request.getSession(false);
        
        // 从HttpSession中读取SecurityContext
		SecurityContext context = readSecurityContextFromSession(httpSession);
		
        // 如果session中不存在就生成一个空的安全上下文
		if (context == null) {
			if (logger.isDebugEnabled()) {
				logger.debug("No SecurityContext was available from the HttpSession: "
						+ httpSession + ". " + "A new one will be created.");
			}
			context = generateNewContext();

		}
        
        ...省略部分代码
    
        // 返回安全上下文信息
		return context;
	}
	
	// 持久化SecurityContext
	public void saveContext(SecurityContext context, HttpServletRequest request,
			HttpServletResponse response) {
		SaveContextOnUpdateOrErrorResponseWrapper responseWrapper = WebUtils
				.getNativeResponse(response,
						SaveContextOnUpdateOrErrorResponseWrapper.class);
		if (responseWrapper == null) {
			throw new IllegalStateException(
					"Cannot invoke saveContext on response "
							+ response
							+ ". You must use the HttpRequestResponseHolder.response after invoking loadContext");
		}
		// saveContext() might already be called by the response wrapper
		// if something in the chain called sendError() or sendRedirect(). This ensures we
		// only call it
		// once per request.
		if (!responseWrapper.isContextSaved()) {
			responseWrapper.saveContext(context);
		}
	}
    
    // 根据SPRING_SECURITY_CONTEXT_KEY从HttpSession获取SecurityContext
	private SecurityContext readSecurityContextFromSession(HttpSession httpSession) {
		final boolean debug = logger.isDebugEnabled();

		if (httpSession == null) {
			if (debug) {
				logger.debug("No HttpSession currently exists");
			}

			return null;
		}

		
        // 获取存储在HttpSession中对应key的值
		Object contextFromSession = httpSession.getAttribute(springSecurityContextKey);

		if (contextFromSession == null) {
			if (debug) {
				logger.debug("HttpSession returned null object for SPRING_SECURITY_CONTEXT");
			}

			return null;
		}

		// We now have the security context object from the session.
		if (!(contextFromSession instanceof SecurityContext)) {
			if (logger.isWarnEnabled()) {
				logger.warn(springSecurityContextKey
						+ " did not contain a SecurityContext but contained: '"
						+ contextFromSession
						+ "'; are you improperly modifying the HttpSession directly "
						+ "(you should always use SecurityContextHolder) or using the HttpSession attribute "
						+ "reserved for this class?");
			}

			return null;
		}

		if (debug) {
			logger.debug("Obtained a valid SecurityContext from "
					+ springSecurityContextKey + ": '" + contextFromSession + "'");
		}

		// Everything OK. The only non-null return from this method.

		return (SecurityContext) contextFromSession;
	}
}
```
从HttpSessionSecurityContextRepository的loadContext方法可以看出，本质上是根据SPRING_SECURITY_CONTEXT_KEY获取到存放在HttpSession中的SecurityContext然后返回，接下来我们再回到SecurityContextPersistenceFilter中，看一下它内部的过滤方法：
``` java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
			throws IOException, ServletException {
		HttpServletRequest request = (HttpServletRequest) req;
		HttpServletResponse response = (HttpServletResponse) res;
		
        // 如果当前过滤器已经执行过了就不执行下面的逻辑，保证只执行一次
		if (request.getAttribute(FILTER_APPLIED) != null) {
			// ensure that filter is only applied once per request
			chain.doFilter(request, response);
			return;
		}

		final boolean debug = logger.isDebugEnabled();
        // 执行到这一步表明这是第一次执行该过滤器，设置已经执行过的标记
		request.setAttribute(FILTER_APPLIED, Boolean.TRUE);
        
        // 是否需要优先创建session
		if (forceEagerSessionCreation) {
			HttpSession session = request.getSession();

			if (debug && session.isNew()) {
				logger.debug("Eagerly created session: " + session.getId());
			}
		}
        
        // 包装HttpServletRequest和HttpServletResponse
		HttpRequestResponseHolder holder = new HttpRequestResponseHolder(request,
				response);
				
		// 从HttpRequestResponseHolder中获取安全上下文信息
		SecurityContext contextBeforeChainExecution = repo.loadContext(holder);

		try {
		    // 将SecurityContext保存起来，下游过滤器就可以使用这个SecurityContext
		    // 注意此时的SecurityContext属于初始化状态，它内部的Authentication是会
		    // 被下游其它过滤器改变的
			SecurityContextHolder.setContext(contextBeforeChainExecution);
            
            // 过滤链继续往下走
			chain.doFilter(holder.getRequest(), holder.getResponse());

		}
		finally {
		    // 取出SecurityContext，此时的SecurityContext里面的内容已经被下游的过滤器改变了
			SecurityContext contextAfterChainExecution = SecurityContextHolder
					.getContext();
			// Crucial removal of SecurityContextHolder contents - do this before anything
			// else.
			// 清空SecurityContext
			SecurityContextHolder.clearContext();
			
			// 在下游过滤器执行完毕后，持久化最终的SecurityContext
			repo.saveContext(contextAfterChainExecution, holder.getRequest(),
					holder.getResponse());
			// 移除已经执行过该过滤器的标记
			request.removeAttribute(FILTER_APPLIED);

			if (debug) {
				logger.debug("SecurityContextHolder now cleared, as request processing completed");
			}
		}
	}
```
分析到这，SecurityContext从创建到获取再到销毁的整个流程大概都理清了，而且我们发现最终SecurityContext是通过另一个SecurityContextHolder类来存储和销毁的，这似乎和SecurityContextRepository有点重复的概念在里面，我的理解是SecurityContextRepository负责初始化生成并保存SecurityContext信息，当下次请求时就可以从session中获取上一次的SecurityContext信息了，相当于缓存的作用。而SecurityContextHolder则负责作为一个载体将查询出来的SecurityContext保存在其中，下游过滤器就可以从SecurityContextHolder中获取到SecurityContext内部的Authentication信息了。

# SecurityContextHolder

在整个请求过程中SecurityContext就保存在这个类中
``` java
public class SecurityContextHolder {
    
    // 线程保存模式
	public static final String MODE_THREADLOCAL = "MODE_THREADLOCAL";
	
	// 能够继承的线程（子线程传递）保存模式
	public static final String MODE_INHERITABLETHREADLOCAL = "MODE_INHERITABLETHREADLOCAL";
	
	// 全局保存模式（通过类的静态变量来传递）
	public static final String MODE_GLOBAL = "MODE_GLOBAL";
	public static final String SYSTEM_PROPERTY = "spring.security.strategy";
	private static String strategyName = System.getProperty(SYSTEM_PROPERTY);
	
	// 当前保存SecurityContext的策略
	private static SecurityContextHolderStrategy strategy;
	private static int initializeCount = 0;

    // 调用初始化方法
	static {
		initialize();
	}

    // 清空保存的SecurityContext
	public static void clearContext() {
		strategy.clearContext();
	}

    // 获取保存的SecurityContext
	public static SecurityContext getContext() {
		return strategy.getContext();
	}

    // 主要用于故障排除，此方法显示该类重新初始化其SecurityContextHolder策略的次数。
	public static int getInitializeCount() {
		return initializeCount;
	}
    
    // 初始化SecurityContextHolderStrategy
	private static void initialize() {
		if (!StringUtils.hasText(strategyName)) {
			// 默认是通过线程局部变量来保存SecurityContext
			strategyName = MODE_THREADLOCAL;
		}

		if (strategyName.equals(MODE_THREADLOCAL)) {
		    // 线程局部变量保存策略
			strategy = new ThreadLocalSecurityContextHolderStrategy();
		}
		else if (strategyName.equals(MODE_INHERITABLETHREADLOCAL)) {
		    // 子线程局部变量保存策略
			strategy = new InheritableThreadLocalSecurityContextHolderStrategy();
		}
		else if (strategyName.equals(MODE_GLOBAL)) {
		    // 静态field保存策略
			strategy = new GlobalSecurityContextHolderStrategy();
		}
		else {
			// 自定义保存策略
			try {
				Class<?> clazz = Class.forName(strategyName);
				Constructor<?> customStrategy = clazz.getConstructor();
				strategy = (SecurityContextHolderStrategy) customStrategy.newInstance();
			}
			catch (Exception ex) {
				ReflectionUtils.handleReflectionException(ex);
			}
		}
        // 初始化保存策略次数加一
		initializeCount++;
	}

    // 保存SecurityContext
	public static void setContext(SecurityContext context) {
		strategy.setContext(context);
	}

    // 更改首选策略。不要为给定的JVM多次调用此方法，因为它将重新初始化策略并对使用旧策略的任何现有
    // 线程产生负面影响。
	public static void setStrategyName(String strategyName) {
		SecurityContextHolder.strategyName = strategyName;
		initialize();
	}

    // 获取当前保存策略
	public static SecurityContextHolderStrategy getContextHolderStrategy() {
		return strategy;
	}

    // 委派给配置的策略创建新的空上下文。
	public static SecurityContext createEmptyContext() {
		return strategy.createEmptyContext();
	}

	@Override
	public String toString() {
		return "SecurityContextHolder[strategy='" + strategyName + "'; initializeCount="
				+ initializeCount + "]";
	}
}
```
# SecurityContextHolderStrategy

![](/images/Spring/Security/SecurityContextHolderStrategy.png)

SecurityContext就保存在这三个实现类中。

# 总结

* SecurityContextPersistenceFilter在请求初始化时通过默认的HttpSessionSecurityContextRepository创建一个新的SecurityContext，首先是从当前session中获取SecurityContext，如果没有则通过SecurityContextHolder的createEmptyContext方法生成一个空的SecurityContext，然后将这个SecurityContext保存到SecurityContextHolder中
* SecurityContextHolder本身不保存SecurityContext，它是通过内部维护的一个SecurityContextHolderStrategy来保存SecurityContext的，Spring Security自带了ThreadLocalSecurityContextHolderStrategy（默认的保存策略），InheritableThreadLocalSecurityContextHolderStrategy和GlobalSecurityContextHolderStrategy这三种策略，当然也可以自定义策略
* SecurityContextHolder将SecurityContext保存到内部的SecurityContextHolderStrategy中后，下游的其它过滤器就可以取这个SecurityContext了进行认证或者授权了



