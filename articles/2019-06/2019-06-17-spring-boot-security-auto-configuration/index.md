---
title: SecurityAutoConfiguration源码分析
date: 2019-06-17
id: 2019-06-17-spring-boot-security-auto-configuration
tags:
  - Spring
  - Spring-Security
  - Spring-Security自动配置
domain: Spring
---

## 核心结论

SecurityAutoConfiguration 通过条件装配引入安全属性、认证事件发布器和 Web 安全配置。满足 Servlet 应用及相关类、Bean 条件时，默认适配器和 @EnableWebSecurity 参与创建 springSecurityFilterChain；默认行为来自多个配置类协作，并非一个配置类完成所有工作。

## 问题与适用范围

本文回答：只引入安全 starter 时，Spring Boot 怎样启用默认安全配置？

本文分析没有自定义安全适配器的 Servlet 应用启动过程。原文逐步写出的“满足条件”依赖这个示例场景，自定义 Bean 或不同 Web 栈可能使这些自动配置退让。

本系列声明的基线为 Spring Boot 2.1.5.RELEASE，其默认管理 Spring Security 5.1.5.RELEASE。正文保留该时期的源码与配置方式，用于理解历史实现，不代表当前版本的全部行为。

## 概述

SecurityAutoConfiguration主要负责在项目启动时为当前的web容器添加一些必要的配置类

<!-- more -->

## SecurityAutoConfiguration

```java
@Configuration
@ConditionalOnClass(DefaultAuthenticationEventPublisher.class)
@EnableConfigurationProperties(SecurityProperties.class)
@Import({ SpringBootWebSecurityConfiguration.class, WebSecurityEnablerConfiguration.class,
		SecurityDataConfiguration.class })
public class SecurityAutoConfiguration {

	@Bean
	@ConditionalOnMissingBean(AuthenticationEventPublisher.class)
	public DefaultAuthenticationEventPublisher authenticationEventPublisher(ApplicationEventPublisher publisher) {
		return new DefaultAuthenticationEventPublisher(publisher);
	}

}

```

1. 将DefaultAuthenticationEventPublisher注册到spring容器中
2. 将SecurityProperties注册到spring容器中
3. 将SpringBootWebSecurityConfiguration、WebSecurityEnablerConfiguration和SecurityDataConfiguration注册到当前容器中

这里我们主要关注一下SpringBootWebSecurityConfiguration、WebSecurityEnablerConfiguration这两个配置类

### SpringBootWebSecurityConfiguration

```java
@Configuration
@ConditionalOnClass(WebSecurityConfigurerAdapter.class)
@ConditionalOnMissingBean(WebSecurityConfigurerAdapter.class)
@ConditionalOnWebApplication(type = Type.SERVLET)
public class SpringBootWebSecurityConfiguration {

	@Configuration
	@Order(SecurityProperties.BASIC_AUTH_ORDER)
	static class DefaultConfigurerAdapter extends WebSecurityConfigurerAdapter {

	}

}
```

1. 判断类路径下是否有WebSecurityConfigurerAdapter，正常情况是肯定有的，**满足条件**
2. 判断spring容器中是否有WebSecurityConfigurerAdapter实例，由于我们没有自己编写自己的类继承它，所以容器中是没有改实例的，**满足条件**
3. 判断当前web应用是不是基于servlet的，springmvc就是基于servlet的，**满足条件**

综上，满足所有条件，将SpringBootWebSecurityConfiguration和DefaultConfigurerAdapter注册到spring容器中

### WebSecurityEnablerConfiguration

```java
@Configuration
@ConditionalOnBean(WebSecurityConfigurerAdapter.class)
@ConditionalOnMissingBean(name = BeanIds.SPRING_SECURITY_FILTER_CHAIN)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableWebSecurity
public class WebSecurityEnablerConfiguration {

}
```

1. 判断spring容器中是否有WebSecurityConfigurerAdapter实例，在上一步的SpringBootWebSecurityConfiguration配置中，最终将WebSecurityConfigurerAdapter的实例DefaultConfigurerAdapter注册到了spring容器中，**满足条件**
2. 判断spring容器中是否没有bean的名称为**springSecurityFilterChain**，默认我们没有自定义这个bean，**满足条件**
3. 判断当前web应用是不是基于servlet的，springmvc就是基于servlet的，**满足条件**

综上，满足所有条件，将WebSecurityEnablerConfiguration实例注册到spring容器中，并且开启EnableWebSecurity注解，这个EnableWebSecurity注解很重要，下面我们来着重分析一下它

#### EnableWebSecurity

```java
@Retention(value = java.lang.annotation.RetentionPolicy.RUNTIME)
@Target(value = { java.lang.annotation.ElementType.TYPE })
@Documented
@Import({ WebSecurityConfiguration.class,
		SpringWebMvcImportSelector.class,
		OAuth2ImportSelector.class })
@EnableGlobalAuthentication
@Configuration
public @interface EnableWebSecurity {

	/**
	 * Controls debugging support for Spring Security. Default is false.
	 * @return if true, enables debug support with Spring Security
	 */
	boolean debug() default false;
}

```

1. 将WebSecurityConfiguration、SpringWebMvcImportSelector和OAuth2ImportSelector注册到spring容器中
2. 开启EnableGlobalAuthentication注解

接下来我们分析一下WebSecurityConfiguration这个配置类为我们配置了哪些类

##### WebSecurityConfiguration

```java
@Configuration
public class WebSecurityConfiguration implements ImportAware, BeanClassLoaderAware {
	private WebSecurity webSecurity;

	private Boolean debugEnabled;

	private List<SecurityConfigurer<Filter, WebSecurity>> webSecurityConfigurers;

	private ClassLoader beanClassLoader;

	@Autowired(required = false)
	private ObjectPostProcessor<Object> objectObjectPostProcessor;

	@Bean
	public static DelegatingApplicationListener delegatingApplicationListener() {
		return new DelegatingApplicationListener();
	}

    // spring-security安全过滤链注册完之后，将SecurityExpressionHandler注册到spring容器中
	@Bean
	@DependsOn(AbstractSecurityWebApplicationInitializer.DEFAULT_FILTER_NAME)
	public SecurityExpressionHandler<FilterInvocation> webSecurityExpressionHandler() {
		return webSecurity.getExpressionHandler();
	}

	// spring-security安全过滤链就是在这里初始化并注册到spring容器中的
	@Bean(name = AbstractSecurityWebApplicationInitializer.DEFAULT_FILTER_NAME)
	public Filter springSecurityFilterChain() throws Exception {
        // 是否有webSecurityConfigurers
		boolean hasConfigurers = webSecurityConfigurers != null
				&& !webSecurityConfigurers.isEmpty();
        // 如果没有则创建一个
		if (!hasConfigurers) {
			WebSecurityConfigurerAdapter adapter = objectObjectPostProcessor
					.postProcess(new WebSecurityConfigurerAdapter() {
					});
			webSecurity.apply(adapter);
		}
		return webSecurity.build();
	}

	@Bean
	@DependsOn(AbstractSecurityWebApplicationInitializer.DEFAULT_FILTER_NAME)
	public WebInvocationPrivilegeEvaluator privilegeEvaluator() throws Exception {
		return webSecurity.getPrivilegeEvaluator();
	}

	@Autowired(required = false)
	public void setFilterChainProxySecurityConfigurer(
			ObjectPostProcessor<Object> objectPostProcessor,
            // 注入autowiredWebSecurityConfigurersIgnoreParents这个bean的getWebSecurityConfigurers返回的值
			@Value("#{@autowiredWebSecurityConfigurersIgnoreParents.getWebSecurityConfigurers()}") List<SecurityConfigurer<Filter, WebSecurity>> webSecurityConfigurers)
			throws Exception {
        // 初始化webSecurity
		webSecurity = objectPostProcessor
				.postProcess(new WebSecurity(objectPostProcessor));
		if (debugEnabled != null) {
			webSecurity.debug(debugEnabled);
		}
		// 对webSecurityConfigurers进行排序
		Collections.sort(webSecurityConfigurers, AnnotationAwareOrderComparator.INSTANCE);

		Integer previousOrder = null;
		Object previousConfig = null;
		for (SecurityConfigurer<Filter, WebSecurity> config : webSecurityConfigurers) {
			Integer order = AnnotationAwareOrderComparator.lookupOrder(config);
			if (previousOrder != null && previousOrder.equals(order)) {
				throw new IllegalStateException(
						"@Order on WebSecurityConfigurers must be unique. Order of "
								+ order + " was already used on " + previousConfig + ", so it cannot be used on "
								+ config + " too.");
			}
			previousOrder = order;
			previousConfig = config;
		}
		for (SecurityConfigurer<Filter, WebSecurity> webSecurityConfigurer : webSecurityConfigurers) {
            // 给WebSecurity添加SecurityConfigurer
			webSecurity.apply(webSecurityConfigurer);
		}
		this.webSecurityConfigurers = webSecurityConfigurers;
	}

	// 在spring容器中注册一个AutowiredWebSecurityConfigurersIgnoreParents实例，bean的name
    // 是autowiredWebSecurityConfigurersIgnoreParents，这个bean就在在上面的
    // setFilterChainProxySecurityConfigurer出用到，用来获取ConfigurableListableBeanFactory
    // 中配置的List<SecurityConfigurer<Filter, WebSecurity>>
	@Bean
	public static AutowiredWebSecurityConfigurersIgnoreParents autowiredWebSecurityConfigurersIgnoreParents(
			ConfigurableListableBeanFactory beanFactory) {
		return new AutowiredWebSecurityConfigurersIgnoreParents(beanFactory);
	}

	// 排序比较器
	private static class AnnotationAwareOrderComparator extends OrderComparator {
		private static final AnnotationAwareOrderComparator INSTANCE = new AnnotationAwareOrderComparator();

		@Override
		protected int getOrder(Object obj) {
			return lookupOrder(obj);
		}

		private static int lookupOrder(Object obj) {
			if (obj instanceof Ordered) {
				return ((Ordered) obj).getOrder();
			}
			if (obj != null) {
				Class<?> clazz = (obj instanceof Class ? (Class<?>) obj : obj.getClass());
				Order order = AnnotationUtils.findAnnotation(clazz, Order.class);
				if (order != null) {
					return order.value();
				}
			}
			return Ordered.LOWEST_PRECEDENCE;
		}
	}

	public void setImportMetadata(AnnotationMetadata importMetadata) {
		Map<String, Object> enableWebSecurityAttrMap = importMetadata
				.getAnnotationAttributes(EnableWebSecurity.class.getName());
		AnnotationAttributes enableWebSecurityAttrs = AnnotationAttributes
				.fromMap(enableWebSecurityAttrMap);
		debugEnabled = enableWebSecurityAttrs.getBoolean("debug");
		if (webSecurity != null) {
			webSecurity.debug(debugEnabled);
		}
	}

	public void setBeanClassLoader(ClassLoader classLoader) {
		this.beanClassLoader = classLoader;
	}
}

```

1. 从ConfigurableListableBeanFactory中找到所有SecurityConfigurer<Filter, WebSecurity>，然后初始化webSecurity，在对所有SecurityConfigurer进行排序
2. 在springSecurityFilterChain实例注册到spring容器中后，将WebInvocationPrivilegeEvaluator、SecurityExpressionHandler、DelegatingApplicationListener等实例注册到spring容器中

##### EnableGlobalAuthentication

```java
@Retention(value = java.lang.annotation.RetentionPolicy.RUNTIME)
@Target(value = { java.lang.annotation.ElementType.TYPE })
@Documented
@Import(AuthenticationConfiguration.class)
@Configuration
public @interface EnableGlobalAuthentication {
}

```

`@EnableWebSecurity`被`EnableGlobalAuthentication`注解了，从EnableGlobalAuthentication注解我们可以看到它的作用是将AuthenticationConfiguration注册到spring容器中

###### AuthenticationConfiguration

```java
@Configuration
@Import(ObjectPostProcessorConfiguration.class)
public class AuthenticationConfiguration {

	private AtomicBoolean buildingAuthenticationManager = new AtomicBoolean();

	private ApplicationContext applicationContext;

	private AuthenticationManager authenticationManager;

	private boolean authenticationManagerInitialized;

	private List<GlobalAuthenticationConfigurerAdapter> globalAuthConfigurers = Collections
			.emptyList();

	private ObjectPostProcessor<Object> objectPostProcessor;

    // 我们熟悉的AuthenticationManager出现了
	@Bean
	public AuthenticationManagerBuilder authenticationManagerBuilder(
			ObjectPostProcessor<Object> objectPostProcessor, ApplicationContext context) {
        // 默认的密码编码者
		LazyPasswordEncoder defaultPasswordEncoder = new LazyPasswordEncoder(context);
        // 这个AuthenticationEventPublisher就是SecurityAutoConfiguration中配置的
        // DefaultAuthenticationEventPublisher
		AuthenticationEventPublisher authenticationEventPublisher = getBeanOrNull(context, AuthenticationEventPublisher.class);
		// 密码编码者构造者，继承了AuthenticationManagerBuilder
		DefaultPasswordEncoderAuthenticationManagerBuilder result = new DefaultPasswordEncoderAuthenticationManagerBuilder(objectPostProcessor, defaultPasswordEncoder);
		if (authenticationEventPublisher != null) {
            // 设置authenticationEventPublisher
			result.authenticationEventPublisher(authenticationEventPublisher);
		}
		return result;
	}

    // 全局认证配置者适配器，主要是用来打印spring容器中的使用@EnableGlobalAuthentication
    // 注解的类
	@Bean
	public static GlobalAuthenticationConfigurerAdapter enableGlobalAuthenticationAutowiredConfigurer(
			ApplicationContext context) {
		return new EnableGlobalAuthenticationAutowiredConfigurer(context);
	}
	// 熟悉的UserDetailsService，主要用来配置UserDetailsService
	@Bean
	public static InitializeUserDetailsBeanManagerConfigurer initializeUserDetailsBeanManagerConfigurer(ApplicationContext context) {
		return new InitializeUserDetailsBeanManagerConfigurer(context);
	}

    // 熟悉的AuthenticationProvider，主要用来配置AuthenticationProvider
	@Bean
	public static InitializeAuthenticationProviderBeanManagerConfigurer initializeAuthenticationProviderBeanManagerConfigurer(ApplicationContext context) {
		return new InitializeAuthenticationProviderBeanManagerConfigurer(context);
	}

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

	@Autowired(required = false)
	public void setGlobalAuthenticationConfigurers(
			List<GlobalAuthenticationConfigurerAdapter> configurers) throws Exception {
		Collections.sort(configurers, AnnotationAwareOrderComparator.INSTANCE);
		this.globalAuthConfigurers = configurers;
	}

	@Autowired
	public void setApplicationContext(ApplicationContext applicationContext) {
		this.applicationContext = applicationContext;
	}

	@Autowired
	public void setObjectPostProcessor(ObjectPostProcessor<Object> objectPostProcessor) {
		this.objectPostProcessor = objectPostProcessor;
	}

	@SuppressWarnings("unchecked")
	private <T> T lazyBean(Class<T> interfaceName) {
		LazyInitTargetSource lazyTargetSource = new LazyInitTargetSource();
		String[] beanNamesForType = BeanFactoryUtils.beanNamesForTypeIncludingAncestors(
				applicationContext, interfaceName);
		if (beanNamesForType.length == 0) {
			return null;
		}
		Assert.isTrue(beanNamesForType.length == 1,
				() -> "Expecting to only find a single bean for type " + interfaceName
						+ ", but found " + Arrays.asList(beanNamesForType));
		lazyTargetSource.setTargetBeanName(beanNamesForType[0]);
		lazyTargetSource.setBeanFactory(applicationContext);
		ProxyFactoryBean proxyFactory = new ProxyFactoryBean();
		proxyFactory = objectPostProcessor.postProcess(proxyFactory);
		proxyFactory.setTargetSource(lazyTargetSource);
		return (T) proxyFactory.getObject();
	}

	private AuthenticationManager getAuthenticationManagerBean() {
		return lazyBean(AuthenticationManager.class);
	}

	private static <T> T getBeanOrNull(ApplicationContext applicationContext, Class<T> type) {
		try {
			return applicationContext.getBean(type);
		} catch(NoSuchBeanDefinitionException notFound) {
			return null;
		}
	}

	private static class EnableGlobalAuthenticationAutowiredConfigurer extends
			GlobalAuthenticationConfigurerAdapter {
		private final ApplicationContext context;
		private static final Log logger = LogFactory
				.getLog(EnableGlobalAuthenticationAutowiredConfigurer.class);

		public EnableGlobalAuthenticationAutowiredConfigurer(ApplicationContext context) {
			this.context = context;
		}

		@Override
		public void init(AuthenticationManagerBuilder auth) {
			Map<String, Object> beansWithAnnotation = context
					.getBeansWithAnnotation(EnableGlobalAuthentication.class);
			if (logger.isDebugEnabled()) {
				logger.debug("Eagerly initializing " + beansWithAnnotation);
			}
		}
	}

	/**
	 * Prevents infinite recursion in the event that initializing the
	 * AuthenticationManager.
	 *
	 * @author Rob Winch
	 * @since 4.1.1
	 */
	static final class AuthenticationManagerDelegator implements AuthenticationManager {
		private AuthenticationManagerBuilder delegateBuilder;
		private AuthenticationManager delegate;
		private final Object delegateMonitor = new Object();

		AuthenticationManagerDelegator(AuthenticationManagerBuilder delegateBuilder) {
			Assert.notNull(delegateBuilder, "delegateBuilder cannot be null");
			this.delegateBuilder = delegateBuilder;
		}

		@Override
		public Authentication authenticate(Authentication authentication)
				throws AuthenticationException {
			if (this.delegate != null) {
				return this.delegate.authenticate(authentication);
			}

			synchronized (this.delegateMonitor) {
				if (this.delegate == null) {
					this.delegate = this.delegateBuilder.getObject();
					this.delegateBuilder = null;
				}
			}

			return this.delegate.authenticate(authentication);
		}

		@Override
		public String toString() {
			return "AuthenticationManagerDelegator [delegate=" + this.delegate + "]";
		}
	}

	static class DefaultPasswordEncoderAuthenticationManagerBuilder extends AuthenticationManagerBuilder {
		private PasswordEncoder defaultPasswordEncoder;

		/**
		 * Creates a new instance
		 *
		 * @param objectPostProcessor the {@link ObjectPostProcessor} instance to use.
		 */
		DefaultPasswordEncoderAuthenticationManagerBuilder(
			ObjectPostProcessor<Object> objectPostProcessor, PasswordEncoder defaultPasswordEncoder) {
			super(objectPostProcessor);
			this.defaultPasswordEncoder = defaultPasswordEncoder;
		}

		@Override
		public InMemoryUserDetailsManagerConfigurer<AuthenticationManagerBuilder> inMemoryAuthentication()
			throws Exception {
			return super.inMemoryAuthentication()
				.passwordEncoder(this.defaultPasswordEncoder);
		}

		@Override
		public JdbcUserDetailsManagerConfigurer<AuthenticationManagerBuilder> jdbcAuthentication()
			throws Exception {
			return super.jdbcAuthentication()
				.passwordEncoder(this.defaultPasswordEncoder);
		}

		@Override
		public <T extends UserDetailsService> DaoAuthenticationConfigurer<AuthenticationManagerBuilder, T> userDetailsService(
			T userDetailsService) throws Exception {
			return super.userDetailsService(userDetailsService)
				.passwordEncoder(this.defaultPasswordEncoder);
		}
	}

	static class LazyPasswordEncoder implements PasswordEncoder {
		private ApplicationContext applicationContext;
		private PasswordEncoder passwordEncoder;

		LazyPasswordEncoder(ApplicationContext applicationContext) {
			this.applicationContext = applicationContext;
		}

		@Override
		public String encode(CharSequence rawPassword) {
			return getPasswordEncoder().encode(rawPassword);
		}

		@Override
		public boolean matches(CharSequence rawPassword,
			String encodedPassword) {
			return getPasswordEncoder().matches(rawPassword, encodedPassword);
		}

		@Override
		public boolean upgradeEncoding(String encodedPassword) {
			return getPasswordEncoder().upgradeEncoding(encodedPassword);
		}

		private PasswordEncoder getPasswordEncoder() {
			if (this.passwordEncoder != null) {
				return this.passwordEncoder;
			}
			PasswordEncoder passwordEncoder = getBeanOrNull(this.applicationContext, PasswordEncoder.class);
			if (passwordEncoder == null) {
				passwordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();
			}
			this.passwordEncoder = passwordEncoder;
			return passwordEncoder;
		}

		@Override
		public String toString() {
			return getPasswordEncoder().toString();
		}
	}
}
```

配置了AuthenticationManagerBuilder、InitializeUserDetailsBeanManagerConfigurer、InitializeAuthenticationProviderBeanManagerConfigurer这些必要的配置类，同时也通过`@Import(ObjectPostProcessorConfiguration.class)`将ObjectPostProcessor注入到spring容器中了

###### ObjectPostProcessorConfiguration

```java
@Configuration
public class ObjectPostProcessorConfiguration {

	@Bean
	public ObjectPostProcessor<Object> objectPostProcessor(
			AutowireCapableBeanFactory beanFactory) {
		return new AutowireBeanFactoryObjectPostProcessor(beanFactory);
	}
}

```

默认的ObjectPostProcessor就是AutowireBeanFactoryObjectPostProcessor

## 总结

1. 将DefaultAuthenticationEventPublisher注册到spring容器中
2. 将DefaultConfigurerAdapter注册到spring容器中
3. 开启@EnableWebSecurity注解，将springSecurityFilterChain，WebSecurity，ObjectPostProcessor,AuthenticationManagerBuilder等配置类注入到spring容器中

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
- [SecurityFilterChain 组件配置迁移指南](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
