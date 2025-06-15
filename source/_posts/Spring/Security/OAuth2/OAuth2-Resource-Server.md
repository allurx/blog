---
title: Spring-Security-OAuth2-Resource-Server
date: 2020-04-04
categories:
- Spring
- Spring-Security
- OAuth2
- Resource-Server
tags:
- Spring
- Spring-Security
- OAuth2-Resource-Server
---

# 概述

在上一篇的Spring-Security-OAuth2-Client文章中我们详细讲解了一个客户端应用是如何通过OAuth2的标准授权协议请求授权服务器获取token的流程，那么当客户端获取到token之后，肯定是要拿着这个token去请求资源服务器获取资源的，也就是说资源服务器的作用其实就是对客户端token的认证和鉴权，只要token校验通过，那么客户端就能拿到相应的资源，这样client和resource-server就衔接起来了，接下来我们就来对spring-security的resource-server的解析流程一探究竟。

<!-- more -->

# 例子

Spring-Security官网给出了很多资源服务器使用的例子[Spring-Security-resource-server-samples](https://github.com/spring-projects/spring-security/tree/master/samples/boot)，主要看里面resource-server相关的demo，由于截止到撰写本文的日期为止，spring-security并没有提供对授权服务器的支持，因此上面的例子中的demo都是通过mock授权服务器来编写的，并且对token的认证和鉴权本质上就是对token的解码与解密/验签，而上面的这些demo就是通过不同的方式来对token进行解析，不同工程使用方式分别对应如下：

1. [oauth2resourceserver-jwe](https://github.com/spring-projects/spring-security/tree/master/samples/boot/oauth2resourceserver-jwe)

   通过JWE（JSON Web Encryption）的方式生成jwt令牌，不同于传统的JWS（JSON Web Signature），具体概念可以参考[JSON Web Encryption](https://www.rfc-editor.org/rfc/rfc7516.html)


2. [oauth2resourceserver-opaque](https://github.com/spring-projects/spring-security/tree/master/samples/boot/oauth2resourceserver-opaque)

   通过自省的方式（即拿到token之后将这个token作为请求参数请求另一个能够对此token进行校验的接口，然后返回认证的信息）

3. [oauth2resourceserver-static](https://github.com/spring-projects/spring-security/tree/master/samples/boot/oauth2resourceserver-static)

   常用的JWS（JSON Web Signature）解析方法，通过rsa算法生成公钥和私钥，使用私钥对token进行签名，然后通过配置的公钥对token进行验签，有关JWS的详情可以参考[JSON Web Signature](https://www.rfc-editor.org/rfc/rfc7515.html)

4. [oauth2resourceserver](https://github.com/spring-projects/spring-security/tree/master/samples/boot/oauth2resourceserver)

   通过jwk-set-uri参数指定用于验证JWT令牌的JWK（JSON Web Key）秘钥集，这是一个使用JavaScript对象表示的json对象，该对象代表了一组JWK，并且该对象必须拥有一个keys键，值为数组，数组中的每个对象即为一个JWK，每个对象都是对一个秘钥的描述。有关JWK详细的信息可以参考[JSON Web Key](https://www.rfc-editor.org/rfc/rfc7517.html)
   
5. [oauth2resourceserver-multitenancy](https://github.com/spring-projects/spring-security/tree/master/samples/boot/oauth2resourceserver-multitenancy)

   支持多种不同的方式对token进行解析，即第2个和第4个工程的结合体。

由于spring-security不支持授权服务器，而上面的例子都是mock授权服务器的，所以理解起来有点困难，不过只要记住一个原则，资源服务器仅仅是用来解析token的，至于是如何解析的，可以是通过公钥验证私钥的签名、自省（委托给内部其它接口解析）、通过jwk-set-uri指定验证JWT令牌的JWK集这其中任何一种方式，归根究底最终还是对token值的解密/验签。下面我们就基于常用的JWS（JSON Web Signature）的方式来对spring-security资源服务器token的解析流程进行分析。

首先和上一节的Spring-Security-OAuth2-Client一样，我们新建一个springboot工程，然后在pom文件加上以下几个依赖

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

```yacas
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

在resource文件夹下新建key.private和key.public文件，key.private文件内容如下

```
-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDGx3U8k3+9/9mLw+djdfMHFREF
Qe5KXQZeOWoerv6U14n/94NJB+FFLVOpK1dQGiN7QyqBeHDQWRRVBDFw8YuqP6OeBFZ/yFm18ODh
Fgos47u0cvqdrtzwdiS+FuXGFkcM6zCeP5kGSOZ8JTPLMrp6p3AwzCpmGkJxaG1yW5pDeTaVPvWA
jSdR8Ww0YT68wmV6lsD50ZdyYVuHjTWbDQGTklaMvdUB2Ycrz53MBcWhnr5fpL3F04he16/ctp4a
TCEt8rhCmuLmspxK3arc99sws93bZQO27W1MY5ejwy361M5TIcCnaoownTd70pedu7i1E6UoGEvI
W6fIeR+eE6ZLAgMBAAECggEBALcFs2ZBEN8qEW3kxMoJMekVdoR2vibuHAzppFH4IiN9iWyKwvCd
NsdxApTCeTQhvQWjRCHNeWH8gwH8SGGLpWLuEYJO0C37lM42qXfVySynyo5NR3+kH32v6gi0IIAQ
xv6YFj2+pPDqcn1f655uaNDCFkR315oHF6I/2nXu7cys0S5menmbIX/zKFZkk+2pbAMCexVbvuB5
wwtd3NX8sCnZDKYOCv/FK8WatAvP3qNv60ApMiza5K+yKjnlP1A6E8mVvUdPKK0NPT0CO0CdEmF6
//1evBQcNgSfEIOakGey7BLCaGkveVCB9ATdwfKIZwo4c+QWL6Kh47T1cD+9cNECgYEA45C3w80s
x0xVFLqvPGA04cVVWNlLdOXMjLV9fcnBUjUCTkmJ4cU8mDybpAM9kz6FYU5g2abDvbOER8V+Sx0W
CyUF90MILoajX/XofDTRBKk0m9eHA0/Q1BdJt8yhfrV8jGz0IUCx/luZR2I+mKEKvUZY0oEDQNDu
rugXYq6OGMUCgYEA353wErjB8pHY9QSH8HuRb5jJTTah3OL492zBaM5g+0690tP2SRAiU9WX55lM
7N9o9UdqFJza9S0q7NZ5NB9+PgAgvwImkFAvOzPK0NFnfT+DZG22z9TLsZkiXxqDvtKdJdljqr0o
Ymzu8Z+s7g7uuqWsDvyrdQIX4irIGHdrE88CgYBJ+WlDRRchUjb2HhmIzt1h5vvvffOBdJIhy32X
vlYRmxm8yTsBIVSpSEpv7n29t70z/H6PQh6vNAP0MMb1M+dOiCKAVlH6jdnd/9orRiAMG9T2NAG3
meKQj2FvVh3JSsXKAED77kPuI2iYQ9+FThRnos6M31NnZoOwZ9HySjv24QKBgQCDYp6twVRjG4Jn
47OjflbjRNfxwAm2aL1zUrkIxUmCHq+1ccihARPKQhMwhogGHPXkN4OCfO7BYzp3UUSBdYeNEjIr
SC40WIiHtlSSAJdXpbujhDsHPbY4sQra6g9CTSj8FhBTPzS9L9fsq67FaIynqbPAUoDDDOnPfud2
SKPnTQKBgQDKz6joTogQHoCMgFz7AQ7FQeDgVqxVwz5ugwyiaF35G1nWz3JAfbH8/sQftxo1oH/k
KNyhSwPCQe6Q9hKYtpwlokshAGxAiOcqsaJn6tu7pWW/DkA1gpSNG/NJSeAJljc1YWs5YqnFWiJp
Pj6jYIbz73yja3nt3vMbaHOs9qeXMQ==
-----END PRIVATE KEY-----
```

key.public文件内容如下

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxsd1PJN/vf/Zi8PnY3XzBxURBUHuSl0G
XjlqHq7+lNeJ//eDSQfhRS1TqStXUBoje0MqgXhw0FkUVQQxcPGLqj+jngRWf8hZtfDg4RYKLOO7
tHL6na7c8HYkvhblxhZHDOswnj+ZBkjmfCUzyzK6eqdwMMwqZhpCcWhtcluaQ3k2lT71gI0nUfFs
NGE+vMJlepbA+dGXcmFbh401mw0Bk5JWjL3VAdmHK8+dzAXFoZ6+X6S9xdOIXtev3LaeGkwhLfK4
Qpri5rKcSt2q3PfbMLPd22UDtu1tTGOXo8Mt+tTOUyHAp2qKMJ03e9KXnbu4tROlKBhLyFunyHkf
nhOmSwIDAQAB
-----END PUBLIC KEY-----
```

然后我们通过spring-security内置对jwt支持的jose库利用上面的私钥生成的一个jwt如下（实际项目中这个jwt应该由我们上一节的client通过oauth2授权协议请求授权服务器获得）

```
eyJhbGciOiJSUzUxMiJ9.eyJzdWIiOiJ6eWMiLCJpYXQiOjE1ODU5OTUwMjd9.n-5ZJAI4XESRpdwq1VYlKzRYyQgIfHJ3fH7AMedGRJ7m6FIvQyq3N-Oxa3aEfOhH3OFsTSTyLHCWS5hrqce8g17SQ-yfy7YOJrNJkevrtNCP1qd57I8270x-nu8JyHKiwr2HShOr3HEco8rIDhYy0S_IniQpTEEDkgMka5CUjVEXSEb-G5KWqdCI8vy63mRPNbRRqlPwV6Tl7jKly-lJtkMJF4hxJppF-QD87diBAxtUCJudU_VTUiJC8-3wnj44JBDNMgnVSlJtlhqUrxUqLeKHFqBxkfHG6K4qNtjOcQm9O0FBx7i2NQXDAMLf_ysbMByuPA99LRCoumsVrUptTg
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
Authorization: Bearer eyJhbGciOiJSUzUxMiJ9.eyJzdWIiOiJ6eWMiLCJpYXQiOjE1ODU5OTUwMjd9.n-5ZJAI4XESRpdwq1VYlKzRYyQgIfHJ3fH7AMedGRJ7m6FIvQyq3N-Oxa3aEfOhH3OFsTSTyLHCWS5hrqce8g17SQ-yfy7YOJrNJkevrtNCP1qd57I8270x-nu8JyHKiwr2HShOr3HEco8rIDhYy0S_IniQpTEEDkgMka5CUjVEXSEb-G5KWqdCI8vy63mRPNbRRqlPwV6Tl7jKly-lJtkMJF4hxJppF-QD87diBAxtUCJudU_VTUiJC8-3wnj44JBDNMgnVSlJtlhqUrxUqLeKHFqBxkfHG6K4qNtjOcQm9O0FBx7i2NQXDAMLf_ysbMByuPA99LRCoumsVrUptTg
```

响应成功返回我们jwt中的认证主体信息

```
Hello, zyc!
```

只需要很简的几个配置参数就完成了资源服务器对token的解析，背后的原理是什么呢？我们看一下控制台的输出，从刚刚启动的信息中我们可以发现spring-security过滤链中多出来了一个BearerTokenAuthenticationFilter过滤器，从这个过滤器的名字我们大概就能知道这个过滤器就是用来解析带Bearer前缀的token的。下面我们来看一下这个过滤器的过滤逻辑

## BearerTokenAuthenticationFilter

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

## JwtAuthenticationProvider

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

对jwt的解析是通过jwtDecoder完成的，从它的名字我们也能知道它是一个对jwt解码的，然后默认的实现是NimbusJwtDecoder类，内部是基于jose库对jwt进行解析的。解析的逻辑有点复杂，这里就不细说了，有兴趣的同学可以自己分析一下。如果上一步的jwt能够解析成功的话，说明这个jwt是有效的，然后就将这个有效的jwt对象通过默认的JwtAuthenticationConverter将其转换成一个已认证的Authentication对象。

## JwtAuthenticationConverter

```java
@Override
public final AbstractAuthenticationToken convert(Jwt jwt) {
    Collection<GrantedAuthority> authorities = extractAuthorities(jwt);
    return new JwtAuthenticationToken(jwt, authorities);
}
```

### extractAuthorities

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

# 自动配置

在上面的例子中我们仅仅只在配置文件中配置了私钥和公钥等信息，没有对spring-security进行任何额外的配置，最终却能完成资源服务区的token解析，这背后的原理同样也是通过spring-boot-autoconfigure自动完成的，我们找到spring-boot-autoconfigure.jar包中的security.oauth2.resource.servlet包，可以发现spring-boot给我们提供了几个自动配置类

```java
OAuth2ResourceServerAutoConfiguration
OAuth2ResourceServerJwtConfiguration
OAuth2ResourceServerOpaqueTokenConfiguration
```

## OAuth2ResourceServerJwtConfiguration

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

# 例子

[使用jwt令牌访问受保护的资源](https://github.com/Allurx/spring-security-oauth2-demo/tree/master/spring-security-oauth2-resourceserver)

# 参考

[spring-boot-oauth2-samples](https://github.com/spring-projects/spring-security/tree/master/samples/boot)

[rfc](https://www.rfc-editor.org/)