---
title: "Spring Security 5.2 的 JWT 资源服务器流程"
date: 2020-04-04
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - OAuth2-Resource-Server
  - OAuth2
  - Resource-Server
domain: Spring
---

资源服务器先验证访问令牌并建立认证信息，再由资源授权规则决定是否允许调用。JWT 的 Base64url 解码、JWS 验签、声明校验和最终授权是不同步骤；只看到一个结构正确的 JSON，不能说明令牌可信。

本文研究 **Spring Boot 2.2.6.RELEASE / Spring Security 5.2.2.RELEASE** 的历史 Servlet JWT 路径。完整例子采用 **Eclipse Temurin JDK 11.0.32.1+1、Maven 3.10.0**，本地测试签发使用 **Node.js 24.19.0 LTS** 标准库。JDK 11 位于旧 Boot 的 Java 8—13 兼容范围；保留旧依赖是为了对照源码，不作为当前新项目推荐。[Boot 运行要求](https://docs.spring.io/spring-boot/docs/2.2.6.RELEASE/reference/html/getting-started.html#getting-started-system-requirements)

这个固定组合用于解释旧实现的过滤器、提供者和解码器怎样协作。新应用应查阅 [当前 JWT 资源服务器文档](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)与 [Spring Boot 当前文档](https://docs.spring.io/spring-boot/)，重新选择受支持依赖及组件配置，不把历史适配器作为当前默认入口。

## 先把签发端与资源服务器分开

本例用 RSA 私钥签发 RS512 JWS，资源服务器只得到公钥。它没有实现完整 OAuth2 授权服务器，也没有把私钥放进应用配置。JWT 是令牌内容格式，JWS 提供签名；JWE 的加密语义不在这个实验中。[RFC 7515](https://www.rfc-editor.org/rfc/rfc7515.html)、[RFC 7519](https://www.rfc-editor.org/rfc/rfc7519.html)

下载 [POM](./pom.xml)、[应用入口](./ResourceServerApplication.java) 和 [本地签发脚本](./create-test-token.mjs)，按下面的目录放置：

```text
experiment/
├─ issuer/
│  └─ create-test-token.mjs
└─ resource-server/
   ├─ pom.xml
   └─ src/main/
      ├─ java/io/allurx/ResourceServerApplication.java
      └─ resources/
         ├─ application.yml
         └─ key.public
```

### 生成自己的测试输入

在空的 issuer 目录运行：

```sh
node --version
node create-test-token.mjs
```

脚本生成 2048 位 RSA 密钥、`key.private`、`key.public` 和 `access-token.txt`；已有同名文件时拒绝覆盖。令牌的 sub 是 `allurx`，iat 是生成时刻，exp 是 10 分钟后。脚本分别把头和载荷编码成 Base64url，再对两段带点号的输入执行 RSA-SHA512 签名。[Node.js 密钥与签名 API](https://nodejs.org/docs/latest-v24.x/api/crypto.html)

只复制 key.public 到资源服务器的 resources 目录。私钥与测试令牌留在本地签发目录；真实业务由授权服务器负责密钥管理。重新生成密钥后，要同步新的公钥并重启服务器，不能把新令牌与旧公钥混用。

### 配置公钥与算法并启动

POM 使用 Boot parent 统一管理 Web 和 OAuth2 Resource Server starter。`application.yml` 为：

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          public-key-location: classpath:key.public
          jws-algorithm: RS512
```

在 resource-server 目录运行：

```sh
java -version
mvn -version
mvn package
java -jar target/historical-resource-server-demo-1.0.0.jar
```

应用没有自定义 WebSecurityConfigurerAdapter，所以能观察 Boot 的默认装配。完整入口的 Controller 核心是：

```java
@GetMapping("/")
public String index(@AuthenticationPrincipal Jwt jwt) {
    return String.format("Hello, %s!", jwt.getSubject());
}
```

## 用成功和失败输入观察边界

使用 HTTP 客户端向 `http://localhost:8080/` 发送 GET，把 access-token.txt 的完整内容替换下面的占位符：

```http
Authorization: Bearer YOUR_SIGNED_ACCESS_TOKEN
```

| 输入 | 本地例子的结果 |
| --- | --- |
| 对应公钥签发、未过期的令牌 | 200，正文 `Hello, allurx!` |
| 不带 Authorization | 401 |
| 保留签名但修改载荷 | 401 |
| 签名正确，但 exp 已超过允许的时钟偏差 | 401 |

这些路径已在上文完整版本组合的 Windows 11 x64 本地环境验证。实验过期输入使用了超出默认时钟偏差的时间，不能用刚跨过 exp 的一瞬间推断校验器忽略过期。它验证的是认证边界，不证明业务的 issuer、audience 或权限规则已经正确。

## BearerTokenAuthenticationFilter 提取令牌并交给管理器

过滤器先用 BearerTokenResolver 读取令牌。没有令牌时继续链，交由后续授权决定是否允许匿名访问；令牌格式错误时立即进入认证入口。存在令牌时，构造未认证的 BearerTokenAuthenticationToken，选择 AuthenticationManager 并委托认证。

成功后创建新的 SecurityContext、放入认证结果，再继续下游链；AuthenticationException 则清理上下文并交给失败处理器。可以从 [BearerTokenAuthenticationFilter 5.2.2 源码](https://github.com/spring-projects/spring-security/blob/5.2.2.RELEASE/oauth2/oauth2-resource-server/src/main/java/org/springframework/security/oauth2/server/resource/web/BearerTokenAuthenticationFilter.java) 对照这些分支。

## JwtDecoder 负责的不只是文本解码

JwtAuthenticationProvider 的核心步骤是：

```java
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

这里的 JwtDecoder 使用配置的公钥与签名算法，并执行声明校验；失败被转换成认证异常。静态公钥配置默认应用时间相关校验，业务若要求固定 issuer、audience 或其他声明，必须配置对应验证器，不能因为验签通过就省略这些约束。[JwtAuthenticationProvider 5.2.2 源码](https://github.com/spring-projects/spring-security/blob/5.2.2.RELEASE/oauth2/oauth2-resource-server/src/main/java/org/springframework/security/oauth2/server/resource/authentication/JwtAuthenticationProvider.java)

## 从 scope 得到权限，再进入资源授权

JwtAuthenticationConverter 把 Jwt 转成 Authentication。默认 JwtGrantedAuthoritiesConverter 先找 `scope` 或 `scp` 声明，接受空格分隔字符串或集合，再给权限添加 `SCOPE_` 前缀。

| 令牌内容 | 默认得到的权限示例 |
| --- | --- |
| `scope: "message:read message:write"` | `SCOPE_message:read`、`SCOPE_message:write` |
| `scp: ["message:read"]` | `SCOPE_message:read` |
| 两项都没有 | 空权限集合，仍可能建立有效认证 |

因此，认证成功和拥有某项权限必须分开。本例令牌没有 scope，而默认接口规则只要求 authenticated，所以可以成功返回主体；若接口要求 `SCOPE_message:read`，就还需要令牌与授权规则配套。自定义 claims 或角色前缀需要配置转换器，不能假定任何名为 roles 的数组都会自动被识别。[权限转换器源码](https://github.com/spring-projects/spring-security/blob/5.2.2.RELEASE/oauth2/oauth2-resource-server/src/main/java/org/springframework/security/oauth2/server/resource/authentication/JwtGrantedAuthoritiesConverter.java)

## Boot 为什么不需要额外适配器也能启动

Boot 根据 `public-key-location` 创建使用 RSA 公钥的 NimbusJwtDecoder，并应用指定 jws-algorithm。没有自定义安全适配器且存在 JwtDecoder 时，默认配置要求所有请求认证，并启用 `oauth2ResourceServer().jwt()` 对应能力。

静态公钥、issuer-uri 和 jwk-set-uri 属于不同解码器装配路径；密钥轮换、授权服务发现和网络可用性边界也不同，不能由这个本地公钥实验推断全部部署行为。[OAuth2ResourceServerJwtConfiguration 2.2.6 源码](https://github.com/spring-projects/spring-boot/blob/v2.2.6.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/oauth2/resource/servlet/OAuth2ResourceServerJwtConfiguration.java)

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

排查 401 时，沿令牌提取、算法与公钥、声明校验逐步定位；排查已认证后的拒绝，则检查权限转换与资源规则。不透明令牌通常通过自省取得状态，属于另一条认证路径，不能套用 JWT 本地验签过程。
