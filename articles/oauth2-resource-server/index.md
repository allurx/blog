---
title: "Spring Security OAuth 2.0 Resource Server"
date: 2020-04-04
updated: 2026-10-02
tags:
  - Spring
  - Spring-Security
  - OAuth2-Resource-Server
  - OAuth2
  - Resource-Server
domain: Spring
---

资源服务器负责验证访问令牌并建立认证信息。JWT 路径由 BearerTokenAuthenticationFilter 提取令牌，认证提供者调用 JwtDecoder 完成解码、验签和声明校验，再把权限转换到 Authentication；不透明令牌则通常通过自省确认状态。通过验签不等于所有资源都已获准访问，最终还要检查权限规则。

下面以 RSA 签名 JWT 为例，使用 Spring Boot 2.2.6.RELEASE 与其默认管理的 Spring Security 5.2.2.RELEASE。公钥和签名算法的装配可对照 [OAuth2ResourceServerJwtConfiguration](https://github.com/spring-projects/spring-boot/blob/v2.2.6.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/oauth2/resource/servlet/OAuth2ResourceServerJwtConfiguration.java)。JWT 验签与 JWE 解密是不同操作，私钥只属于令牌签发端。

## 概述

在上一篇的Spring-Security-OAuth2-Client文章中我们详细讲解了一个客户端应用是如何通过OAuth2的标准授权协议请求授权服务器获取token的流程，那么当客户端获取到token之后，肯定是要拿着这个token去请求资源服务器获取资源的，也就是说资源服务器先验证访问令牌并建立认证信息，再依据资源上的授权规则判断能否访问；令牌有效不代表拥有所有资源的权限，这样client和resource-server就衔接起来了，接下来我们就来对spring-security的resource-server的解析流程一探究竟。


## 例子

资源服务器的验证方式取决于令牌格式。签名 JWT 需要验证签名与声明；不透明令牌通常由自省端点确认状态；JWE 还涉及解密。它们取得认证信息之后，都要继续执行资源授权，不能把令牌有效等同于允许所有操作。

下面选择静态 RSA 公钥验证 JWS：签发端用私钥签名，资源服务器仅持有公钥。使用 Spring Boot 2.2.6.RELEASE 的 parent 或 BOM 管理版本，在已有 Web 工程中添加以下依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

在配置文件中加上下面的配置

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          public-key-location: classpath:key.public
          jws-algorithm: RS512
logging:
  level:
    org.springframework.security: debug
```

在独立的本地测试目录中，用 OpenSSL 3 生成一对仅供本次示例使用的 RSA 密钥：

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out key.private
openssl pkey -in key.private -pubout -out key.public
```

把 `key.public` 复制到资源服务器的 `src/main/resources/`，与上面的 `classpath:key.public` 对应。`key.private` 只用于本地测试签发令牌，不放进资源服务器或版本库；真实授权服务器应自行管理签名密钥。这样每位读者都会生成自己的测试密钥，命令参数见 [OpenSSL genpkey](https://docs.openssl.org/3.0/man1/openssl-genpkey/) 与 [OpenSSL pkey](https://docs.openssl.org/3.0/man1/openssl-pkey/)。

测试签发端需要使用 `key.private` 签发算法为 `RS512`、`sub` 为 `allurx` 且未过期的 JWT，与资源服务器的 `jws-algorithm` 对应。下面的 `YOUR_SIGNED_ACCESS_TOKEN` 是输入占位符，需要替换为该令牌；修改载荷后必须重新签名。实际应用中，客户端通过 OAuth2 授权流程取得授权服务器签发的访问令牌。

```
YOUR_SIGNED_ACCESS_TOKEN
```

新建一个controller用来获取当前认证的信息

```java
@RestController
public class UserController {

    @GetMapping("/")
    public String index(@AuthenticationPrincipal Jwt jwt) {
        return String.format("Hello, %s!", jwt.getSubject());
    }
}
```

最后启动springboot工程（可以不需要写一个类继承WebSecurityConfigurerAdapter），访问`localhost:8080`，记得在请求头中带上我们刚刚创建的token值

```
Authorization: Bearer YOUR_SIGNED_ACCESS_TOKEN
```

响应成功返回我们jwt中的认证主体信息

```
Hello, allurx!
```

只需要很简的几个配置参数就完成了资源服务器对token的解析，背后的原理是什么呢？我们看一下控制台的输出，从刚刚启动的信息中我们可以发现spring-security过滤链中多出来了一个BearerTokenAuthenticationFilter过滤器，从这个过滤器的名字我们大概就能知道这个过滤器就是用来解析带Bearer前缀的token的。下面我们来看一下这个过滤器的过滤逻辑

### BearerTokenAuthenticationFilter

```java
@Override
protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
    throws ServletException, IOException {

    final boolean debug = this.logger.isDebugEnabled();

    String token;

    try {
        // 尝试从请求中解析出bearer token值
        token = this.bearerTokenResolver.resolve(request);
    } catch ( OAuth2AuthenticationException invalid ) {
        this.authenticationEntryPoint.commence(request, response, invalid);
        return;
    }
	// 不是bearer token认证请求的话继续让其它过滤器执行
    if (token == null) {
        filterChain.doFilter(request, response);
        return;
    }

    // 构造一个未认证的BearerTokenAuthenticationToken
    BearerTokenAuthenticationToken authenticationRequest = new BearerTokenAuthenticationToken(token);

    authenticationRequest.setDetails(this.authenticationDetailsSource.buildDetails(request));

    try {
        // 找出能够对BearerTokenAuthenticationToken进行认证管理的AuthenticationManager
        AuthenticationManager authenticationManager = this.authenticationManagerResolver.resolve(request);

        // 委托给这个AuthenticationManager进行认证
        Authentication authenticationResult = authenticationManager.authenticate(authenticationRequest);

        // 认证成功之后将认证信息保存到安全上下文中
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authenticationResult);
        SecurityContextHolder.setContext(context);

        filterChain.doFilter(request, response);
    } catch (AuthenticationException failed) {
        SecurityContextHolder.clearContext();

        if (debug) {
            this.logger.debug("Authentication request for failed!", failed);
        }

        this.authenticationFailureHandler.onAuthenticationFailure(request, response, failed);
    }
}
```

BearerTokenAuthenticationFilter的认证逻辑与常见的认证过滤器差不多，最终都是委托给AuthenticationManager进行认证。而AuthenticationManager内部则寻找能够对BearerTokenAuthenticationToken进行认证的AuthenticationProvider，这里默认实现是JwtAuthenticationProvider，我们继续看它内部的认证逻辑

### JwtAuthenticationProvider

```java
@Override
public Authentication authenticate(Authentication authentication) throws AuthenticationException {
    BearerTokenAuthenticationToken bearer = (BearerTokenAuthenticationToken) authentication;

    Jwt jwt;
    try {
        jwt = this.jwtDecoder.decode(bearer.getToken());
    } catch (JwtException failed) {
        OAuth2Error invalidToken = invalidToken(failed.getMessage());
        throw new OAuth2AuthenticationException(invalidToken, invalidToken.getDescription(), failed);
    }

    AbstractAuthenticationToken token = this.jwtAuthenticationConverter.convert(jwt);
    token.setDetails(bearer.getDetails());

    return token;
}
```

JwtDecoder 不只解码文本，还负责签名与声明校验。这里的 NimbusJwtDecoder 使用配置的 RSA 公钥与签名算法，并应用默认的时间校验；业务若要求特定 issuer 或 audience，还需配置对应校验器。校验通过后，JwtAuthenticationConverter 将 Jwt 转为 Authentication，之后的授权规则才决定它能访问哪些资源。

### JwtAuthenticationConverter

```java
@Override
public final AbstractAuthenticationToken convert(Jwt jwt) {
    Collection<GrantedAuthority> authorities = extractAuthorities(jwt);
    return new JwtAuthenticationToken(jwt, authorities);
}
```

#### extractAuthorities

继续委托给内部的JwtGrantedAuthoritiesConverter转换器获取jwt对象claim中的权限信息

```java
@Deprecated
protected Collection<GrantedAuthority> extractAuthorities(Jwt jwt) {
    return this.jwtGrantedAuthoritiesConverter.convert(jwt);
}
```

获取claim中权限的方法

```java
private Collection<String> getAuthorities(Jwt jwt) {
    String claimName = getAuthoritiesClaimName(jwt);

    if (claimName == null) {
        return Collections.emptyList();
    }

    Object authorities = jwt.getClaim(claimName);
    if (authorities instanceof String) {
        if (StringUtils.hasText((String) authorities)) {
            return Arrays.asList(((String) authorities).split(" "));
        } else {
            return Collections.emptyList();
        }
    } else if (authorities instanceof Collection) {
        return (Collection<String>) authorities;
    }

    return Collections.emptyList();
}
```

先找权限属性的名称，然后将claim中这个属性拿出来放到集合中。

最后JwtAuthenticationConverter通过JwtAuthenticationToken的另一个已认证的构造函数构造认证信息

```java
public JwtAuthenticationToken(Jwt jwt, Collection<? extends GrantedAuthority> authorities) {
    super(jwt, authorities);
    this.setAuthenticated(true);
    this.name = jwt.getSubject();
}
```

最终经过我们的controller后被`@AuthenticationPrincipal`的参数Jwt会从当前安全上下文拿出JwtAuthenticationToken的Jwt对象。整个解析流程就结束了。

## 自动配置

在上面的例子中我们仅仅只在配置文件中配置了私钥和公钥等信息，没有对spring-security进行任何额外的配置，最终却能完成资源服务区的token解析，这背后的原理同样也是通过spring-boot-autoconfigure自动完成的，我们找到spring-boot-autoconfigure.jar包中的security.oauth2.resource.servlet包，可以发现spring-boot给我们提供了几个自动配置类

```java
OAuth2ResourceServerAutoConfiguration
OAuth2ResourceServerJwtConfiguration
OAuth2ResourceServerOpaqueTokenConfiguration
```

### OAuth2ResourceServerJwtConfiguration

```java
@Bean
@Conditional(KeyValueCondition.class)
JwtDecoder jwtDecoderByPublicKeyValue() throws Exception {
    RSAPublicKey publicKey = (RSAPublicKey) KeyFactory.getInstance("RSA")
        .generatePublic(new X509EncodedKeySpec(getKeySpec(this.properties.readPublicKey())));
    return NimbusJwtDecoder.withPublicKey(publicKey)
        .signatureAlgorithm(SignatureAlgorithm.from(this.properties.getJwsAlgorithm())).build();
}

@Configuration(proxyBeanMethods = false)
	@ConditionalOnMissingBean(WebSecurityConfigurerAdapter.class)
	static class OAuth2WebSecurityConfigurerAdapter {

		@Bean
		@ConditionalOnBean(JwtDecoder.class)
		WebSecurityConfigurerAdapter jwtDecoderWebSecurityConfigurerAdapter() {
			return new WebSecurityConfigurerAdapter() {

				@Override
				protected void configure(HttpSecurity http) throws Exception {
					http.authorizeRequests((requests) -> requests.anyRequest().authenticated());
					http.oauth2ResourceServer(OAuth2ResourceServerConfigurer::jwt);
				}

			};
		}

	}
```

主要关注其中这两个配置，第一个JwtDecoder配置会根据我们配置文件中的public-key-location、jwt.issuer-uri、jwk-set-uri"来确定最终的jwt解码器。第二个WebSecurityConfigurerAdapter由于我们没有编写额外的spirng-security配置，所以最终会注入一个默认的WebSecurityConfigurerAdapter子类，如果想要知道资源服务器的配置原理你只需要去OAuth2ResourceServerConfigurer类中的init和configure方法中看一下就能明白内部配置的原理了以及BearerTokenAuthenticationFilter是什么时候添加到过滤器链中的。

## 例子

[使用jwt令牌访问受保护的资源](https://github.com/allurx/spring-security-oauth2-demo/tree/master/spring-security-oauth2-resourceserver)

## 资料来源

- [RFC 7515：JSON Web Signature](https://www.rfc-editor.org/rfc/rfc7515.html)
- [RFC 7519：JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519.html)
- [Spring Boot 2.2.6.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.2.6.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.2.2.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.2.2.RELEASE/reference/htmlsingle/)
- [当前 OAuth2 参考文档](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html)
