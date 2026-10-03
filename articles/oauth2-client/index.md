---
title: "Spring Security 5.2 的 OAuth 2.0 登录流程"
date: 2020-03-29
updated: 2026-10-03
tags:
  - Spring
  - Spring-Security
  - OAuth2-Client
  - OAuth2
  - Client
domain: Spring
---

使用 GitHub 登录一个应用时，浏览器跳转、服务端交换令牌、读取用户资料和建立应用内登录状态是几个不同阶段。Spring Security 用不同过滤器与提供者连接它们；区分这些职责，才能定位回调丢失、state 不匹配或令牌交换失败。

本文研究 **Spring Boot 2.2.6.RELEASE / Spring Security 5.2.2.RELEASE** 的历史 Servlet 授权码登录。复现基线为 **Eclipse Temurin JDK 11.0.32.1+1、Maven 3.10.0**，选择 JDK 11 是为了满足旧 Boot 声明的 Java 8—13 兼容范围。旧依赖用于对照源码，不是新项目推荐版本。[该版本运行要求](https://docs.spring.io/spring-boot/docs/2.2.6.RELEASE/reference/html/getting-started.html#getting-started-system-requirements)

应先理解授权码和访问令牌的区别：OAuth 2.0 授予的是资源访问权，应用可在取得第三方资料后建立自己的身份；OpenID Connect 另有身份协议语义。[RFC 6749 授权码流程](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1)

本文适合对照或维护这一历史实现。新应用的组件配置、授权方式与兼容版本应从 [当前 OAuth2 Login 文档](https://docs.spring.io/spring-security/reference/servlet/oauth2/login/core.html)和 [Spring Boot 当前文档](https://docs.spring.io/spring-boot/)进入；下文适配器、POM 和源码必须作为同一历史版本组合阅读。

## 先准备能独立启动的本地应用

下载 [完整 POM](./pom.xml) 和 [OAuthClientApplication.java](./OAuthClientApplication.java)，按下列目录放置文件：

```text
oauth-client-demo/
├─ pom.xml
└─ src/main/
   ├─ java/io/allurx/OAuthClientApplication.java
   └─ resources/application.yml
```

POM 由 Boot parent 管理 `spring-boot-starter-oauth2-client` 和 `spring-boot-starter-web`。入口类提供公开首页、受保护的 `/user`，并通过 `oauth2Login()` 接入登录流程；这不是只有配置片段、缺少 main 方法的工程。

### OAuth App 的回调必须与本地地址一致

在 [GitHub OAuth Apps](https://github.com/settings/developers) 创建自己的测试应用。本例没有上下文路径，默认端口为 8080：

| 字段 | 本地示例值与作用 |
| --- | --- |
| Application name | 可辨认的测试名称，例如 `Local OAuth Demo` |
| Homepage URL | `http://localhost:8080` |
| Authorization callback URL | `http://localhost:8080/login/oauth2/code/github` |

修改端口、上下文路径或反向代理公开地址时，要同步修改回调注册。当前平台操作见 [GitHub OAuth App 创建文档](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)；历史截图中的其他项目路径不应直接复制。

把自己取得的客户端凭据通过运行环境注入 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`，不要保存到文章或 Git 仓库。`application.yml` 内容为：

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          github:
            clientId: ${GITHUB_CLIENT_ID}
            clientSecret: ${GITHUB_CLIENT_SECRET}
logging:
  level:
    org.springframework.security: debug
```

在项目根目录执行 `mvn package`，再运行 `java -jar target/historical-oauth-client-demo-1.0.0.jar`。应用启动可以验证本地装配；完整授权仍需要有效的 OAuth App、可达的 GitHub 端点和用户授权，编译成功不能替代这一步。

### 观察完整登录与失败路径

打开首页，点击 GitHub 登录链接，浏览器先请求 `/oauth2/authorization/github`；允许授权后返回回调，登录成功后可访问 `/user`，看到提供者对应的主体标识。直接未登录访问 `/user`，本例配置返回 401。

同时观察取消授权、回调所在浏览器会话丢失和重复使用旧回调的情况。它们失败的位置不同，不应全部解释成“客户端密码错误”。外部平台页面与账号权限可能变化，本文的源码分析不保证历史依赖长期兼容所有提供者变化。

## 四种数据对象分别保存什么

| 对象 | 内容与生命周期 |
| --- | --- |
| ClientRegistration | 提供者地址、client id、回调模板、scope 等静态注册信息 |
| OAuth2AuthorizationRequest | 本次待完成授权的 state、scope、回调等请求信息 |
| OAuth2AuthenticationToken | 应用内已经建立的用户认证信息 |
| OAuth2AuthorizedClient | 注册信息、关联主体、访问令牌和可选刷新令牌 |

Authentication 解决应用内“当前主体是谁”，AuthorizedClient 保存应用调用第三方资源所需的授权材料；二者不能只因出现在同一次登录里就混为一个对象。

## 发起授权：解析、保存、重定向

OAuth2AuthorizationRequestRedirectFilter 将请求交给 DefaultOAuth2AuthorizationRequestResolver。默认解析器从发起地址提取 registrationId，例如 `github`，再查 ClientRegistrationRepository，构造带随机 state 的授权请求。

解析器只负责生成请求；真正的保存发生在过滤器发送重定向之前：

```java
private void sendRedirectForAuthorization(HttpServletRequest request, HttpServletResponse response,
                                            OAuth2AuthorizationRequest authorizationRequest) throws IOException {

    if (AuthorizationGrantType.AUTHORIZATION_CODE.equals(authorizationRequest.getGrantType())) {
        this.authorizationRequestRepository.saveAuthorizationRequest(authorizationRequest, request, response);
    }
    this.authorizationRedirectStrategy.sendRedirect(request, response, authorizationRequest.getAuthorizationRequestUri());
}
```

默认 AuthorizationRequestRepository 使用 HttpSession 保存。这个状态用于稍后校验回调，不能把它说成 Resolver 内部顺带完成的存储工作。默认重定向策略调用响应重定向，让**浏览器**转到 GitHub，授权完成后同样由浏览器返回应用回调；这不是 GitHub 在后台直接调用本地 Controller。

该版本解析器还按配置处理 OIDC nonce 和公共客户端的 PKCE 参数。它们的适用条件应读具体源码，不能把历史实现中存在的其他授权模式分支当作今天的推荐方案。

[重定向过滤器 5.2.2 源码](https://github.com/spring-projects/spring-security/blob/5.2.2.RELEASE/oauth2/oauth2-client/src/main/java/org/springframework/security/oauth2/client/web/OAuth2AuthorizationRequestRedirectFilter.java)、[默认解析器 5.2.2 源码](https://github.com/spring-projects/spring-security/blob/5.2.2.RELEASE/oauth2/oauth2-client/src/main/java/org/springframework/security/oauth2/client/web/DefaultOAuth2AuthorizationRequestResolver.java)

## 接收回调：把原请求与授权响应配对

OAuth2LoginAuthenticationFilter 匹配默认 `/login/oauth2/code/*` 回调。它确认参数构成授权响应，从仓库移除此前保存的请求，取得关联 ClientRegistration，再构造 OAuth2AuthorizationExchange 和未认证的 OAuth2LoginAuthenticationToken。

| 检查点 | 失败说明 |
| --- | --- |
| 参数不能构成授权响应 | 不是合法回调输入；提供者返回的授权错误也必须按失败路径处理 |
| 找不到原授权请求 | 会话、仓库存储或重复回调等条件使原请求不可取得 |
| 找不到 registrationId | 当前注册配置与原请求不一致 |
| 原请求与响应校验失败 | state 等关联信息不符合要求 |

过滤器随后委托 AuthenticationManager。真正的授权交换检查和令牌请求由提供者完成，而不是只凭 URL 上出现一个 code 就建立登录。[登录过滤器 5.2.2 源码](https://github.com/spring-projects/spring-security/blob/5.2.2.RELEASE/oauth2/oauth2-client/src/main/java/org/springframework/security/oauth2/client/web/OAuth2LoginAuthenticationFilter.java)

## 提供者校验交换信息，再取令牌与用户资料

对普通 OAuth2 登录，OAuth2LoginAuthenticationProvider 先校验授权交换，再通过 OAuth2AccessTokenResponseClient 向令牌端点交换 access token，之后用 OAuth2UserService 读取用户资料。权限经 GrantedAuthoritiesMapper 映射后，提供者返回已认证结果。

如果 scope 包含 `openid`，该提供者返回 null，将处理机会交给 OIDC 提供者；这解释了“支持同一种流程附近的令牌”不等于“当前提供者必须独占处理”。

令牌交换是应用服务端与提供者之间的请求，不能把 client secret 放到浏览器拼出来的授权链接里。读取用户资料也使用服务端持有的访问令牌。[OAuth2LoginAuthenticationProvider 5.2.2 源码](https://github.com/spring-projects/spring-security/blob/5.2.2.RELEASE/oauth2/oauth2-client/src/main/java/org/springframework/security/oauth2/client/authentication/OAuth2LoginAuthenticationProvider.java)

## 保存应用认证与已授权客户端

过滤器把成功结果转换为 OAuth2AuthenticationToken，并构造包含访问、刷新令牌的 OAuth2AuthorizedClient，通过 AuthorizedClientRepository 保存。父类继续执行会话策略和登录成功处理，安全上下文的跨请求持久化由相应外层过滤器负责。

Boot 的默认装配关系如下：

| 配置 | 提供什么 |
| --- | --- |
| OAuth2ClientRegistrationRepositoryConfiguration | 从属性创建 ClientRegistration，存入内存注册仓库 |
| CommonOAuth2Provider | 为 GitHub 等已知提供者补默认端点与属性；自定义提供者仍需自己的配置 |
| OAuth2WebSecurityConfiguration | 默认已授权客户端服务与仓库；缺少自定义适配器时提供默认 Web 配置 |

本例定义了自己的 WebSecurityConfigurerAdapter，因此默认适配器会退让，但注册和已授权客户端组件仍按各自条件装配。内存服务不等于重启后仍然保存令牌；持久化策略与账号登录状态要分开设计。[Boot 2.2.6 OAuth2WebSecurityConfiguration](https://github.com/spring-projects/spring-boot/blob/v2.2.6.RELEASE/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/security/oauth2/client/servlet/OAuth2WebSecurityConfiguration.java)

文中框架源码摘录来自所链接的固定版本，版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。省略部分通过原始实现查阅，摘录不作为独立 Java 程序编译。

## 按阶段定位故障

发起地址没有跳转，先查 registrationId 和解析器；回调找不到原请求，先查同一浏览器会话与仓库；交换令牌失败，再查 client 凭据、回调与提供者响应；已经登录却不能访问资源，则检查应用自己的授权规则。后续携带访问令牌请求受保护 API 的另一侧，见 [OAuth2 Resource Server](/oauth2-resource-server/)。
