---
title: "发布 JAR 包到 Maven 中央仓库"
date: 2019-08-22
updated: 2026-10-02
tags:
  - Maven
domain: Maven
---

发布到 Maven Central 需要先取得命名空间权限，再准备完整的 POM、主 JAR、源码 JAR、Javadoc JAR 和签名，最后上传到 Central Publisher Portal 验证并发布。上传成功与公开发布是两个阶段，应分别确认；正式版本发布后不能覆盖同一坐标。

以下示例面向已能通过本地构建的普通 JAR 项目，使用 Central 发布插件；多模块、SNAPSHOT 和已有发布父 POM 的工程需要按自身结构调整。下面固定插件版本以便复现配置；运行环境仍需满足这些插件与项目自身的 JDK 要求。


## 取得命名空间权限

在 [Central Publisher Portal](https://central.sonatype.com/) 登录，检查目标 groupId 所属命名空间是否已验证。使用自有域名时，按门户给出的验证值设置域名 TXT 记录；使用 GitHub 身份时，可采用对应的 io.github 用户命名空间，具体权限以门户中的 Verified 状态为准。

命名空间代表发布权，不能仅因 pom.xml 填了一个 groupId 就在该坐标下发布。[命名空间注册与验证](https://central.sonatype.org/register/namespace/)。

## 准备发布元数据与签名

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

普通 JAR 项目还要附加源码与 Javadoc，并为发布文件生成 .asc 签名。Central 插件负责打包、上传和校验和，不会代替其他插件生成全部必要产物。[Central 产物与 POM 要求](https://central.sonatype.org/publish/requirements/)。

本地安装 GnuPG，准备自己的签名密钥，并按[官方 PGP 指南](https://central.sonatype.org/publish/requirements/gpg/)让验证服务能够取得公钥。已有有效密钥可以继续使用，无需每次发布都重新生成：

```sh
gpg --version
gpg --list-secret-keys --keyid-format LONG
```

需要新建密钥时使用 gpg --full-generate-key，按提示设置自己的身份、有效期和口令。发布的是公钥，私钥和口令应保留在自己的受控环境。工作站签名优先使用 gpg-agent 提示输入口令；CI 按 [Maven GPG Plugin 文档](https://maven.apache.org/plugins/maven-gpg-plugin/usage.html)通过受控的秘密配置提供，避免把口令写到 POM 或命令历史中。

## 配置 Portal 凭据

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

## 配置发布 profile

将下面的 profile 合入现有 POM 的 profiles 元素。source 和 javadoc 先附加产物，GPG 在 verify 阶段签名，Central 插件在 deploy 阶段生成上传 bundle。项目原有的编译、测试和 Java 版本配置继续由项目维护。

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

## 构建、上传与确认发布

先执行本地构建，确认目标版本、测试结果及附加产物：

```sh
mvn -Prelease clean verify
```

检查 target 中的主 JAR、sources JAR、javadoc JAR 和签名，以及最终 POM 的实际内容。确认发布的是正式版本；这里的流程没有配置 SNAPSHOT 发布。

准备好发布后执行：

```sh
mvn -Prelease deploy
```

此命令会向 Central 上传，属于外部发布流程。根据日志中的 deploymentId 到门户查看对应 deployment；验证失败时按该对象的错误修正，不能仅凭 BUILD SUCCESS 认为消费者已经可用。验证通过后，在门户确认发布，并核对状态为 Published，再通过实际 GAV 检查消费者能否解析依赖。索引和仓库传播可能需要时间，无法立即搜索到不等于上传没有执行。

正式版本的相同 GAV 不可覆盖。需要修正已发布内容时发布新版本；上传结果不明时，先按 deploymentId 回读门户状态，避免重复提交。[Central 版本不可变规则](https://central.sonatype.org/publish/requirements/immutability/)。

## 资料来源

- [Central 命名空间验证](https://central.sonatype.org/register/namespace/)
- [Central 发布要求](https://central.sonatype.org/publish/requirements/)
- [Portal 发布令牌](https://central.sonatype.org/publish/generate-portal-token/)
- [Central Maven 插件及版本说明](https://central.sonatype.org/publish/publish-portal-maven/)
- [Maven Source Plugin](https://maven.apache.org/plugins/maven-source-plugin/usage.html)
- [Maven Javadoc Plugin](https://maven.apache.org/plugins/maven-javadoc-plugin/usage.html)
- [Maven GPG Plugin](https://maven.apache.org/plugins/maven-gpg-plugin/usage.html)
