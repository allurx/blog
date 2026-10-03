---
title: "发布 JAR 包到 Maven 中央仓库"
date: 2019-08-22
updated: 2026-10-03
tags:
  - Maven
domain: Maven
---

一个工具库在本地能打出 JAR，还不意味着其他项目已经可以通过 Maven 坐标使用它。Maven Central 还需要确认谁有权发布这个命名空间、产物附带哪些项目资料，以及签名能否验证。

下面把一个已有的普通 JAR 项目接入 Central Publisher Portal：先准备发布身份，再让 Maven 生成所需产物，上传验证后在门户确认公开发布。采用人工确认模式，是为了在正式版本变为不可覆盖之前，保留一个检查最终上传内容的节点。

## 开始前确认项目与工具

以下示例面向已能通过本地构建的普通 JAR 项目，使用 Central 发布插件；多模块、SNAPSHOT 和已有发布父 POM 的工程需要按自身结构调整。通用工具基线采用 **JDK 25 LTS、Apache Maven 3.10.0、GnuPG 2.5.24**。Maven 3.10.0 是稳定版，GnuPG 2.5 属于官方长期支持系列；使用发行版回移安全补丁的包时，还要核对该发行版的支持渠道，不能只比较上游版本数字。[Maven 版本](https://maven.apache.org/download.cgi)、[GnuPG 版本与支持说明](https://gnupg.org/download/index.html)

文章中的 POM 是合入已有项目的发布配置，不是独立可运行工程。项目需要较低 Java 目标字节码或特定 JDK 时，应保留自己的 `release` 与 toolchain 配置。先运行 `java -version`、`mvn -version`、`gpg --version` 确认实际执行工具，尤其注意 `mvn -version` 显示的 Java 可能与另一个终端不同。下文固定发布插件版本，不把本地构建成功解释为 Portal 已接受、公开仓库已发布。


## 确认发布权限并配置上传凭据

### 命名空间决定可以使用哪个 groupId

在 [Central Publisher Portal](https://central.sonatype.com/) 登录，检查目标 groupId 所属命名空间是否已验证。使用自有域名时，按门户给出的验证值设置域名 TXT 记录；使用 GitHub 身份时，可采用对应的 io.github 用户命名空间，具体权限以门户中的 Verified 状态为准。

命名空间代表发布权，不能仅因 pom.xml 填了一个 groupId 就在该坐标下发布。[命名空间注册与验证](https://central.sonatype.org/register/namespace/)。

### Portal 令牌让 Maven 代表发布账号上传

在门户的 [User Tokens](https://central.sonatype.com/usertoken) 页面生成发布令牌，保存其中的 token username 与 token password。它们用于发布认证，与网站登录密码、GPG 密钥口令属于不同凭据。[令牌生成说明](https://central.sonatype.org/publish/generate-portal-token/)。

将以下 server 合入用户自己的 Maven settings.xml 的 servers 元素。实际令牌通过运行环境提供；环境变量占位符由 Maven 解析。

```xml
<server>
    <id>central</id>
    <username>${env.CENTRAL_TOKEN_USERNAME}</username>
    <password>${env.CENTRAL_TOKEN_PASSWORD}</password>
</server>
```

settings.xml 的常见位置是用户目录下的 .m2/settings.xml，也可以通过 Maven 的 -s 参数指定文件。不要把含实际凭据的本机 settings.xml 提交到项目仓库。

## 让产物带上使用者需要的资料

### POM 描述项目归属与源码位置

POM 应包含项目名称、描述、URL、许可证、开发者和 SCM 信息，内容必须对应实际项目。下面展示需要合入现有 POM 的元数据结构，所有 YOUR_ 开头的值都需要替换；许可证应填写项目真正采用的许可证。

```xml
<groupId>io.github.YOUR_GITHUB_USER</groupId>
<artifactId>YOUR_ARTIFACT_ID</artifactId>
<version>1.0.0</version>

<name>YOUR_PROJECT_NAME</name>
<description>YOUR_PROJECT_DESCRIPTION</description>
<url>https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY</url>

<licenses>
    <license>
        <name>YOUR_LICENSE_NAME</name>
        <url>YOUR_LICENSE_URL</url>
    </license>
</licenses>

<developers>
    <developer>
        <name>YOUR_NAME</name>
        <url>https://github.com/YOUR_GITHUB_USER</url>
    </developer>
</developers>

<scm>
    <connection>scm:git:https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY.git</connection>
    <developerConnection>scm:git:ssh://git@github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY.git</developerConnection>
    <url>https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY</url>
</scm>
```

### 源码、Javadoc 与签名各自解决什么

消费方下载主 JAR 运行代码，IDE 则可以下载源码 JAR 与 Javadoc JAR 帮助阅读 API。签名用于验证发布文件的签署信息。这些用途不同，所以只成功生成主 JAR 还不够。

普通 JAR 项目还要附加源码与 Javadoc，并为发布文件生成 .asc 签名。Central 插件负责打包、上传和校验和，不会代替其他插件生成全部必要产物。[Central 产物与 POM 要求](https://central.sonatype.org/publish/requirements/)。

本地安装 GnuPG，准备自己的签名密钥，并按[官方 PGP 指南](https://central.sonatype.org/publish/requirements/gpg/)让验证服务能够取得公钥。已有有效密钥可以继续使用，无需每次发布都重新生成：

```sh
gpg --version
gpg --list-secret-keys --keyid-format LONG
```

需要新建密钥时使用 gpg --full-generate-key，按提示设置自己的身份、有效期和口令。发布的是公钥，私钥和口令应保留在自己的受控环境。工作站签名优先使用 gpg-agent 提示输入口令；CI 按 [Maven GPG Plugin 文档](https://maven.apache.org/plugins/maven-gpg-plugin/usage.html)通过受控的秘密配置提供，避免把口令写到 POM 或命令历史中。

## 用 release profile 组织产物生成与上传

将下面的 profile 合入现有 POM 的 profiles 元素。读这段配置时，可以沿 Maven 生命周期跟踪文件的产生：package 阶段附加源码和 Javadoc，verify 阶段生成签名，deploy 阶段把文件打成 bundle 并上传。项目原有的编译、测试和 Java 版本配置继续由项目维护。

```xml
<profile>
    <id>release</id>
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-source-plugin</artifactId>
                <version>3.4.0</version>
                <executions>
                    <execution>
                        <id>attach-sources</id>
                        <phase>package</phase>
                        <goals>
                            <goal>jar-no-fork</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-javadoc-plugin</artifactId>
                <version>3.12.0</version>
                <executions>
                    <execution>
                        <id>attach-javadoc</id>
                        <phase>package</phase>
                        <goals>
                            <goal>jar</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-gpg-plugin</artifactId>
                <version>3.2.8</version>
                <executions>
                    <execution>
                        <id>sign-artifacts</id>
                        <phase>verify</phase>
                        <goals>
                            <goal>sign</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>
            <plugin>
                <groupId>org.sonatype.central</groupId>
                <artifactId>central-publishing-maven-plugin</artifactId>
                <version>0.11.0</version>
                <extensions>true</extensions>
                <configuration>
                    <publishingServerId>central</publishingServerId>
                    <autoPublish>false</autoPublish>
                    <waitUntil>validated</waitUntil>
                </configuration>
            </plugin>
        </plugins>
    </build>
</profile>
```

publishingServerId 必须与 settings.xml 中的 server id 一致。示例保留人工发布：插件等待门户验证通过，但不会自动让版本公开。参数语义与后续版本差异以 [Central Maven 插件文档](https://central.sonatype.org/publish/publish-portal-maven/)为准。

如果项目已有发布 profile 或父 POM 提供同类插件，应合并到现有配置中，避免重复生成、签名或上传。

## 从本地构建走到消费者可用

### 先检查本地发布产物

先执行本地构建，确认目标版本、测试结果及附加产物：

```sh
mvn -Prelease clean verify
```

检查 target 中的主 JAR、sources JAR、javadoc JAR 和签名，以及最终 POM 的实际内容。确认发布的是正式版本；这里的流程没有配置 SNAPSHOT 发布。

### 上传后，沿 deploymentId 确认门户结果

准备好发布后执行：

```sh
mvn -Prelease deploy
```

deploy 会向 Central 上传 bundle。根据日志中的 deploymentId 到门户查看对应 deployment；验证失败时按该对象的错误修正，不能仅凭 BUILD SUCCESS 认为消费者已经可用。验证通过后，在门户确认发布，并核对状态为 Published，再通过实际 GAV 检查消费者能否解析依赖。索引和仓库传播可能需要时间，无法立即搜索到不等于上传没有执行。

如果门户仍处于验证阶段，应检查这一次 deployment 的结果；如果状态已经 Published，却暂时无法搜索到，则需要继续核对仓库传播和实际坐标解析。把两者分开，才能决定是修复上传内容，还是等待发布结果可见。

正式版本的相同 GAV 不可覆盖。需要修正已发布内容时发布新版本；上传结果不明时，先按 deploymentId 回读门户状态，避免重复提交。[Central 版本不可变规则](https://central.sonatype.org/publish/requirements/immutability/)。

## 资料来源

- [Central 命名空间验证](https://central.sonatype.org/register/namespace/)
- [Central 发布要求](https://central.sonatype.org/publish/requirements/)
- [Portal 发布令牌](https://central.sonatype.org/publish/generate-portal-token/)
- [Central Maven 插件及版本说明](https://central.sonatype.org/publish/publish-portal-maven/)
- [Maven Source Plugin](https://maven.apache.org/plugins/maven-source-plugin/usage.html)
- [Maven Javadoc Plugin](https://maven.apache.org/plugins/maven-javadoc-plugin/usage.html)
- [Maven GPG Plugin](https://maven.apache.org/plugins/maven-gpg-plugin/usage.html)
