---
title: WebSecurityConfigurerAdapter源码分析
date: 2019-06-29
categories:
- Spring
- Spring-Security
- Spring-Security自动配置
tags:
- Spring
- Spring-Security
- Spring-Security自动配置
---

# 概述

在上一篇WebSecurity源码分析中我们知道了，HttpSecurity是通过WebSecurityConfigurerAdapter进行配置的，默认情况下如果我们没有编写WebSecurityConfigurerAdapter的子类，那它是如何完成配置的呢？其实在SpringBootWebSecurityConfiguration中有一个默认的WebSecurityConfigurerAdapter的子类

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

这就是spring-security为我们默认添加的一个适配器，如果我们在项目中自己定义了一个类继承WebSecurityConfigurerAdapter的话，这个默认的类就不会被加载了。

<!-- more -->

# WebSecurityConfigurerAdapter

```java
@Order(100)
public abstract class WebSecurityConfigurerAdapter implements
      WebSecurityConfigurer<WebSecurity> {
   private final Log logger = LogFactory.getLog(WebSecurityConfigurerAdapter.class);

   private ApplicationContext context;

   private ContentNegotiationStrategy contentNegotiationStrategy = new HeaderContentNegotiationStrategy();

   private ObjectPostProcessor<Object> objectPostProcessor = new ObjectPostProcessor<Object>() {
      public <T> T postProcess(T object) {
         throw new IllegalStateException(
               ObjectPostProcessor.class.getName()
                     + " is a required bean. Ensure you have used @EnableWebSecurity and @Configuration");
      }
   };
   // 自动注入
   private AuthenticationConfiguration authenticationConfiguration;
   // 自动注入为DefaultPasswordEncoderAuthenticationManagerBuilder
   private AuthenticationManagerBuilder authenticationBuilder;
   // 自动注入为DefaultPasswordEncoderAuthenticationManagerBuilder
   private AuthenticationManagerBuilder localConfigureAuthenticationBldr;
   // 是否通过默认的AuthenticationManagerBuilder构建AuthenticationManager
   private boolean disableLocalConfigureAuthenticationBldr;
   // 认证管理者是否已经初始化
   private boolean authenticationManagerInitialized;
   // 认证管理者
   private AuthenticationManager authenticationManager;
   private AuthenticationTrustResolver trustResolver = new AuthenticationTrustResolverImpl();
   // SpringSecurityFilterChain就是通过HttpSecurity构建出来的
   private HttpSecurity http;
   // 是否禁用默认的HttpSecurity配置
   private boolean disableDefaults;
   // 默认是不对HttpSecurity进行配置的
   protected WebSecurityConfigurerAdapter() {
      this(false);
   }

   protected WebSecurityConfigurerAdapter(boolean disableDefaults) {
      this.disableDefaults = disableDefaults;
   }
   // 如果子类重写了该方法就意味着不通过默认的AuthenticationManagerBuilder构建
   // AuthenticationManager
   protected void configure(AuthenticationManagerBuilder auth) throws Exception {
      this.disableLocalConfigureAuthenticationBldr = true;
   }
   // 这就是默认的过滤器配置的地方
   @SuppressWarnings({ "rawtypes", "unchecked" })
   protected final HttpSecurity getHttp() throws Exception {
      if (http != null) {
         return http;
      }
      // 默认的事件发布者
      DefaultAuthenticationEventPublisher eventPublisher = objectPostProcessor
            .postProcess(new DefaultAuthenticationEventPublisher());
      // 给默认的AuthenticationManagerBuilder设置事件发布者
      localConfigureAuthenticationBldr.authenticationEventPublisher(eventPublisher);
	  // 获取AuthenticationManager
      AuthenticationManager authenticationManager = authenticationManager();
      // 给AuthenticationManagerBuilder设置父AuthenticationManager
      authenticationBuilder.parentAuthenticationManager(authenticationManager);
      // 给AuthenticationManagerBuilder设置事件发布者
      authenticationBuilder.authenticationEventPublisher(eventPublisher);
      // 创建共享的对象
      Map<Class<? extends Object>, Object> sharedObjects = createSharedObjects();
	  // new一个HttpSecurity
      http = new HttpSecurity(objectPostProcessor, authenticationBuilder,
            sharedObjects);
      // 判断是否禁用默认的HttpSecurity配置，默认disableDefaults为false
      // 这就是spring-security为我们配置的默认过滤器
      if (!disableDefaults) {
         // @formatter:off
         http
            .csrf().and()
            .addFilter(new WebAsyncManagerIntegrationFilter())
            .exceptionHandling().and()
            .headers().and()
            .sessionManagement().and()
            .securityContext().and()
            .requestCache().and()
            .anonymous().and()
            .servletApi().and()
            .apply(new DefaultLoginPageConfigurer<>()).and()
            .logout();
         // @formatter:on
         ClassLoader classLoader = this.context.getClassLoader();
         // 从类路径下中出定义在META-INF/spring.factories中的AbstractHttpConfigurer
         List<AbstractHttpConfigurer> defaultHttpConfigurers =
               SpringFactoriesLoader.loadFactories(AbstractHttpConfigurer.class, classLoader);
		 // 将这些AbstractHttpConfigurer应用于HttpSecurity
         for (AbstractHttpConfigurer configurer : defaultHttpConfigurers) {
            http.apply(configurer);
         }
      }
      // 配置HttpSecurity，给HttpSecurity添加属性，一般我们都是重写该方法，添加认证过滤器之类的操作
      configure(http);
      return http;
   }
   public AuthenticationManager authenticationManagerBean() throws Exception {
      return new AuthenticationManagerDelegator(authenticationBuilder, context);
   }
  
   // 获取AuthenticationManager
   protected AuthenticationManager authenticationManager() throws Exception {
      if (!authenticationManagerInitialized) {
         // 配置默认的AuthenticationManagerBuilder
         configure(localConfigureAuthenticationBldr);
         // 如果禁用默认的AuthenticationManagerBuilder
         if (disableLocalConfigureAuthenticationBldr) {
            // 从authenticationConfiguration中获取AuthenticationManager
            // 这个authenticationConfiguration是在自动配置中被注册到spring容器中的
            authenticationManager = authenticationConfiguration
                  .getAuthenticationManager();
         }
         // 否则从默认的AuthenticationManagerBuilder中构建AuthenticationManager
         else {
            authenticationManager = localConfigureAuthenticationBldr.build();
         }
         authenticationManagerInitialized = true;
      }
      return authenticationManager;
   }

   public UserDetailsService userDetailsServiceBean() throws Exception {
      AuthenticationManagerBuilder globalAuthBuilder = context
            .getBean(AuthenticationManagerBuilder.class);
      return new UserDetailsServiceDelegator(Arrays.asList(
            localConfigureAuthenticationBldr, globalAuthBuilder));
   }

   protected UserDetailsService userDetailsService() {
      AuthenticationManagerBuilder globalAuthBuilder = context
            .getBean(AuthenticationManagerBuilder.class);
      return new UserDetailsServiceDelegator(Arrays.asList(
            localConfigureAuthenticationBldr, globalAuthBuilder));
   }
   // 很重的方法WebSecurity就是在这个地方被初始化的，将HttpSecurity作为它的SecurityBuilder
   public void init(final WebSecurity web) throws Exception {
      final HttpSecurity http = getHttp();
      // 将HttpSecurity添加到WebSecurity内部维护的SecurityBuilder列表中
      // 并且设置它的postBuildAction为一个新的Runnale，最终设置了我们熟悉的
      // FilterSecurityInterceptor
      web.addSecurityFilterChainBuilder(http).postBuildAction(new Runnable() {
         public void run() {
            FilterSecurityInterceptor securityInterceptor = http
                  .getSharedObject(FilterSecurityInterceptor.class);
            web.securityInterceptor(securityInterceptor);
         }
      });
   }

   public void configure(WebSecurity web) throws Exception {
   }
   // 配置HttpSecurity，一般我们都是重写该方法给HttpSecurity添加过滤器，设置请求权限等等
   protected void configure(HttpSecurity http) throws Exception {
      logger.debug("Using default configure(HttpSecurity). If subclassed this will potentially override subclass configure(HttpSecurity).");

      http
         .authorizeRequests()
            .anyRequest().authenticated()
            .and()
         .formLogin().and()
         .httpBasic();
   }

   protected final ApplicationContext getApplicationContext() {
      return this.context;
   }
   // 自动注入context，初始化authenticationBuilder，localConfigureAuthenticationBldr
   @Autowired
   public void setApplicationContext(ApplicationContext context) {
      this.context = context;

      ObjectPostProcessor<Object> objectPostProcessor = context.getBean(ObjectPostProcessor.class);
      LazyPasswordEncoder passwordEncoder = new LazyPasswordEncoder(context);

      authenticationBuilder = new DefaultPasswordEncoderAuthenticationManagerBuilder(objectPostProcessor, passwordEncoder);
      localConfigureAuthenticationBldr = new DefaultPasswordEncoderAuthenticationManagerBuilder(objectPostProcessor, passwordEncoder) {
         @Override
         public AuthenticationManagerBuilder eraseCredentials(boolean eraseCredentials) {
            authenticationBuilder.eraseCredentials(eraseCredentials);
            return super.eraseCredentials(eraseCredentials);
         }

      };
   }
   // 如果用户自定义，覆盖默认的AuthenticationTrustResolver，
   @Autowired(required = false)
   public void setTrustResolver(AuthenticationTrustResolver trustResolver) {
      this.trustResolver = trustResolver;
   }
   // 如果用户自定义，覆盖默认的ContentNegotiationStrategy
   @Autowired(required = false)
   public void setContentNegotationStrategy(
         ContentNegotiationStrategy contentNegotiationStrategy) {
      this.contentNegotiationStrategy = contentNegotiationStrategy;
   }
   // 自动注入ObjectPostProcessor
   @Autowired
   public void setObjectPostProcessor(ObjectPostProcessor<Object> objectPostProcessor) {
      this.objectPostProcessor = objectPostProcessor;
   }
   // 自动注入AuthenticationConfiguration
   @Autowired
   public void setAuthenticationConfiguration(
         AuthenticationConfiguration authenticationConfiguration) {
      this.authenticationConfiguration = authenticationConfiguration;
   }
   // 创建共享对象
   private Map<Class<? extends Object>, Object> createSharedObjects() {
      Map<Class<? extends Object>, Object> sharedObjects = new HashMap<Class<? extends Object>, Object>();
      sharedObjects.putAll(localConfigureAuthenticationBldr.getSharedObjects());
      sharedObjects.put(UserDetailsService.class, userDetailsService());
      sharedObjects.put(ApplicationContext.class, context);
      sharedObjects.put(ContentNegotiationStrategy.class, contentNegotiationStrategy);
      sharedObjects.put(AuthenticationTrustResolver.class, trustResolver);
      return sharedObjects;
   }
   ... 省略部分代码
}
```

WebSecurityConfigurerAdapter是一个很方便的整合各种安全配置的基类，我们可以通过继承这个基类来配置HttpSecurity，AuthenticationManagerBuilder等。

# 总结

1. 默认的WebSecurityConfigurerAdapter是DefaultConfigurerAdapter
2. DefaultConfigurerAdapter是用来配置WebSecurity的，DefaultConfigurerAdapter调用init方法将HttpSecurity添加到WebSecurity的SecurityBuilder列表中

