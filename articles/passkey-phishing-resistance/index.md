---
title: Passkey 为什么能抵抗传统凭据钓鱼
date: 2026-10-22
domain: 信息安全
tags: [Passkey, WebAuthn, Phishing Resistance, Public Key Cryptography]
---

钓鱼页面之所以能骗走密码，是因为密码是一段可以由人读取、复制并提交给任意网站的共享秘密。用户误把 `company.com` 看成 `companny.com` 时，浏览器仍会照常把输入框里的内容交给后者。短信验证码和一次性口令缩短了秘密的有效期，却没有改变“用户可以把凭据转交给错误站点”这个前提。

Passkey 改变了凭据的使用方式。私钥由认证器管理，网站拿到的是公钥；登录时也不传输可复用的秘密，而是对本次挑战和站点上下文生成签名。浏览器与认证器会检查凭据所属的 Relying Party，因此仿冒站点通常连调用正确私钥的机会都没有。

本文以 [Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/) 描述的 WebAuthn 认证流程为准，解释这种抗钓鱼能力来自哪些绑定。讨论的攻击模型是诱导用户访问相似域名或反向代理页面并提交登录凭据，不把 XSS、会话令牌窃取、设备失陷或薄弱的账户恢复流程算作已经解决的问题。

## 注册时为每个 Relying Party 生成独立密钥

网站在 WebAuthn 中称为 **Relying Party（RP）**。用户[注册新凭据](https://www.w3.org/TR/webauthn-3/#sctn-registering-a-new-credential)时，服务器生成一次性 `challenge`，浏览器调用 `navigator.credentials.create()`，认证器再为该 RP 创建一对非对称密钥：

```text
认证器保存：credential ID、private key、RP ID、user handle ...
服务器保存：credential ID、public key、user account、counter ...
```

私钥不会作为登录材料发送给服务器。服务器数据库即使泄露，攻击者得到的公钥也只能验证签名，不能据此生成新的有效签名。每个 RP 使用独立密钥对，所以一个站点泄露的凭据记录也不能拿到另一个站点重放。

Passkey 是客户端可发现的公钥凭据。认证器可以按 RP ID 找到候选账户，让用户不先输入用户名就选择身份。WebAuthn 也支持由服务器先通过 `allowCredentials` 提供 credential ID 的服务器端凭据，后者通常不称为 passkey。两种查找方式不会改变后续的站点绑定和签名验证。

注册本身必须在可信上下文中完成。若攻击者已经控制真实站点的脚本，或者账户恢复流程允许攻击者先登录再登记自己的 passkey，后续签名再安全也无法纠正错误的初始绑定。

## RP ID 让相似域名拿不到正确凭据

公钥凭据具有 [**RP ID scope**](https://www.w3.org/TR/webauthn-3/#scope)。默认 RP ID 是调用页面的有效域名，也可以显式设为该域名自身或它的可注册父域。例如 `https://login.example.com` 可以使用 `login.example.com` 或 `example.com`，但不能把 RP ID 设置成无关的 `bank.example`，也不能设置成公共后缀 `com`。

这条规则由浏览器和认证器共同执行。假设用户已为 `company.com` 注册 passkey，随后打开外观完全相同的 `companny.com`：

```text
真实站点 origin: https://company.com
真实凭据 RP ID: company.com

钓鱼站点 origin: https://companny.com
钓鱼站点可用 RP ID: companny.com
```

钓鱼站点若按自己的 RP ID 请求认证，认证器中没有匹配凭据。它若声称 RP ID 是 `company.com`，浏览器会因为该值不是当前域名自身或可注册后缀而拒绝请求。用户不需要辨认输入框由谁提供，系统已经把可用凭据限制在正确的 RP 范围内。

RP ID 不等于完整 origin。它不包含协议和端口，设为父域时还会覆盖相应子域。服务端因此仍要验证客户端数据里的 `origin`，通常应与少量明确允许的 HTTPS origin 精确匹配。把 `example.com` 下所有子域都无条件加入允许列表，会让托管用户内容或存在脚本注入的子域进入认证信任边界。

## 签名同时绑定挑战、origin 和 RP ID

一次认证从服务器生成随机 `challenge` 开始。浏览器调用 `navigator.credentials.get()` 后，认证器返回 `authenticatorData` 和签名，浏览器同时返回 `clientDataJSON`。它们各自承载不同层次的上下文：

| 数据                  | 关键内容                                                        | 由谁形成   |
| --------------------- | --------------------------------------------------------------- | ---------- |
| `clientDataJSON`      | 操作类型、`challenge`、`origin`、跨源状态及可选的 `topOrigin`   | 浏览器     |
| `authenticatorData`   | `SHA-256(RP ID)`、UP/UV 等标志、签名计数器及可选扩展            | 认证器     |
| `signature`           | 对认证器数据和客户端数据哈希的签名                              | 认证器私钥 |

签名覆盖的消息可以简化表示为：

$$
\operatorname{Sign}_{sk}(\text{authenticatorData} \parallel \operatorname{SHA256}(\text{clientDataJSON}))
$$

服务器用注册时保存的公钥验证签名，还要逐项比较上下文。按照[认证断言验证流程](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion)，至少包括：

1. `type` 必须是 `webauthn.get`。
2. 返回的 `challenge` 必须等于本次由服务器生成并暂存的值。
3. `origin` 必须属于服务器明确允许的来源。
4. `rpIdHash` 必须等于预期 RP ID 的 SHA-256 值。
5. 用户存在（UP）和用户验证（UV）标志必须满足本次策略。
6. `signature` 必须能由该 credential record 的公钥验证。

这些值不是彼此独立的表单字段。攻击者把 `origin` 从钓鱼域名改成真实域名，会改变 `clientDataJSON` 的哈希并破坏签名；把 RP ID 换成真实站点，也会让 `rpIdHash` 与认证器实际签署的值不符。

## 随机挑战阻止旧断言被再次使用

站点绑定解决“签给谁”，随机挑战解决“签的是哪一次请求”。服务器应在可信环境中生成难以猜测的挑战，临时保存，并在认证完成后失效。[规范的挑战安全要求](https://www.w3.org/TR/webauthn-3/#sctn-cryptographic-challenges)建议挑战至少包含 16 字节熵。

若攻击者录下过去完整的 WebAuthn 响应，再把它交给服务器，新登录使用的挑战已经不同。攻击者不能修改已签名的 `clientDataJSON`，也没有私钥为新挑战产生签名，因此旧断言不能作为通用登录令牌重放。

[`signCount`](https://www.w3.org/TR/webauthn-3/#sctn-sign-counter) 可以提供额外的克隆风险信号。认证器若实现计数器，服务器会比较新值与已保存值；非递增结果可能意味着私钥存在多个副本、认证器故障或请求处理乱序。它不是抗重放的唯一根基，因为规范允许不实现计数器并始终返回零，同步 passkey 的并发使用也需要风险化处理。

## 生物识别和 PIN 只在本地解锁签名能力

用户看到的人脸、指纹或设备 PIN 是 **User Verification（UV）**。认证器在本地完成验证，成功后在 `authenticatorData` 中设置 UV 标志；生物模板和 PIN 不会发送给网站。服务器只判断这次签名是否带有满足策略的验证结果。

User Presence（UP）与 UV 也不同。触摸安全密钥或确认系统提示可以证明有人同意本次操作，但不一定区分是哪位用户。要求 `userVerification: "required"` 的高价值场景，应在服务端确认 UV 标志，而不能因为浏览器调用成功就假定已经完成生物识别或 PIN 校验。

这种本地授权提高了被盗设备上的使用门槛，却不是抗钓鱼的核心来源。真正让相似域名失败的是 RP ID scope、origin 校验和被签名的上下文。即使用户在钓鱼页面上按下指纹，错误 origin 也不能得到一份可被真实 RP 接受的断言。

## 同步 passkey 与设备绑定 passkey 改变的是密钥保管

Passkey 可以由凭据管理器加密同步到用户的其他设备，也可以只保留在单个设备或硬件安全密钥中。两者使用相同的站点绑定和 WebAuthn 挑战—响应流程，因此都能抵抗把凭据提交给相似域名的传统钓鱼。[FIDO 的 passkey 安全说明](https://www.passkeycentral.org/introduction-to-passkeys/passkey-security)也将密钥保管与协议的抗钓鱼属性分开讨论。

差别集中在私钥如何复制、恢复和解锁。同步 passkey 提高了可用性，但安全性也依赖凭据管理器账户、设备加入流程、端到端加密和账户恢复。设备绑定 passkey 更容易保证只有一个硬件持有私钥，适合高保证场景，却需要准备备用认证器，否则设备丢失可能直接导致账户无法访问。

认证器证明（attestation）可以帮助机构判断凭据由哪类认证器生成、是否符合特定硬件策略。它服务于设备信任与合规，不是每个普通网站都必须收集的登录要素，也不应与用户每次登录时产生的 assertion signature 混为一谈。

## 抗钓鱼不等于账户不会被接管

Passkey 消除了最常见的“把可复用秘密交给假站点”路径，但认证系统还有其他边界：

- 真实 origin 上的 XSS 或被攻陷的第三方脚本处在凭据作用域内，可以发起认证并操纵登录后的页面。
- 登录成功后的会话 Cookie 仍可能被恶意软件、服务端漏洞或错误配置窃取，WebAuthn 不会自动保护会话生命周期。
- 弱密码、短信验证码或人工客服若仍能重置账户，攻击者会绕过 passkey，选择更弱的恢复路径。
- 已解锁设备上的恶意软件、被接管的凭据管理器账户和不安全的设备注册流程可能暴露或滥用同步凭据。
- WebAuthn 断言确认用户同意了一次认证操作，并不会自动证明用户看见并批准了某笔交易的完整金额和收款方。

部署时需要让 passkey 覆盖登录、敏感操作和恢复流程，而不是只把它作为密码旁边的可选按钮。服务端必须严格验证 challenge、origin、RP ID hash、UP/UV 标志和签名，并把同步策略、设备丢失、凭据撤销与会话保护纳入同一套威胁模型。

Passkey 的抗钓鱼能力并不依赖用户更仔细地看网址。系统把凭据限定在 RP ID 范围内，再用签名把本次 challenge、调用 origin 和认证器上下文绑定在一起。钓鱼站点既拿不到可复用秘密，也无法把自己 origin 下的断言改造成真实站点可以接受的结果。这个机制解决的是凭据钓鱼，账户的最终安全仍取决于注册、恢复、同步设备、站点脚本和登录后会话是否同样守住边界。
