---
title: 发布jar包到Maven中央仓库
date: 2019-08-22
categories:
- Maven
tags:
- Maven
---

# 概述

平时在开发的过程中我们经常会借助第三方jar包来完成我们的功能。我们在maven的pom文件中写好这些jar包的groupId、artifactId以及version，这些jar包就能够自动下载到我们的本地maven仓库，然后我们就能在代码中引用这些第三方jar包中的类了，其实这些第三方jar包是存放在maven的中心仓库中的，这样大家就能统一去这个中央仓库下载它们。本章将要介绍如何将我们自己写好的jar包发布到中央仓库中供其他人下载引用。

<!-- more -->

# sonatype

Sonatype是一个通过Nexus对开源项目提供托管服务的网站。你可以通过它发布项目的快照（snapshot）或者稳定版本（release）到Maven中央仓库。我们只需要注册一个Sonatype的账号，新建一个issue，然后在项目的pom文件中进行配置即可将我们的工程打包成jar包发布到maven中央仓库中。

## 注册账号

在[sonatype-issues](https://issues.sonatype.org)这个网站上注册一个账号

## 新建一个issue

登录之后点击上方的新建按钮新建一个issue

![](/images/Maven/SonaType/Issue1.png)

## 在issue中填入一些必要的信息

* 项目：Community Support - Open Source Project Repository Hosting (OSSRH)
* 问题类型：New Project
* 概要：对工程的总体描述
* 描述：详细描述一下这个工程
* Group Id：对应工程的中pom文件中的groupId，注意这个groupId必须是自己拥有的域名，如果没有域名的话可以填上你自己的github主页，例如com.github.xxx，**必须和pom文件中的groupId保持一致，否则最后release会失败**
* Project URL：对应工程的路径，填上自己github项目的地址即可
* SCM url：对应工程源码地址，填上github项目的源码地址即可

## 验证groupId是我们拥有的域名

提交issue之后，系统会发送一个邮件给你，并且给出下一步操作，用来确认在上一步中我们填写的groupId是自己拥有的域名

![](/images/Maven/SonaType/Issue2.png)

按照提示，我们在自己域名的dns解析记录中添加一个TXT类型值为JIRA ticket的解析记录，然后点击上方的respond按钮，等待回应。等管理员审核通过之后，接下来我们就可以开始准备打包部署我们的jar包了，并且此刻的工程状态变成了已解决转态

![](/images/Maven/SonaType/Issue3.png)

注意，工程的状态必须是已解决才能去打包部署，不然最终我们依旧无法发布我们的jar包到maven中央仓库中

# maven配置

接下来我们只需要在pom文件中配置一些打包和部署相关的配置，就能将我们的jar包发布到maven中央仓库中



## settings.xml配置

首先我们需要在maven的全局配置文件中对即将要发布的仓库的账号信息进行配置，在servers节点下添加下面两个server

```xml
<servers>
    <!-- 快照仓库的账号密码-->
    <server>
        <id>sonatype-nexus-snapshots</id>
        <username>账号</username>
        <password>密码</password>
    </server>
    <!-- 正式发布的仓库密码-->
    <server>
        <id>sonatype-nexus-staging</id>
        <username>账号</username>
        <password>密码</password>
    </server>
</servers>
```

上面这两个仓库的账号密码就是我们之前注册的sonatype网站的账号密码

## pom文件配置

license、scm和developers的相关配置

```xml
<licenses>
    <license>
        <name>The Apache Software License, Version 2.0</name>
        <url>http://www.apache.org/licenses/LICENSE-2.0.txt</url>
        <distribution>repo</distribution>
    </license>
</licenses>

<scm>
    <url>https://github.com/Allurx/desensitization</url>
    <connection>scm:git:https://github.com/Allurx/desensitization.git</connection>
    <developerConnection>scm:git:https://github.com/Allurx/desensitization.git</developerConnection>
</scm>

<issueManagement>
    <system>GitHub Issues</system>
    <url>https://github.com/Allurx/desensitization/issues</url>
</issueManagement>

<developers>
    <developer>
        <name>zyc</name>
        <email>allurx@foxmail.com</email>
        <url>https://www.zyc.red</url>
    </developer>
</developers>
```

profile和仓库地址配置

```xml
<distributionManagement>
    <snapshotRepository>
        <id>sonatype-nexus-snapshots</id>
        <name>Nexus Snapshots Repository</name>
        <url>https://oss.sonatype.org/content/repositories/snapshots/</url>
    </snapshotRepository>
    <repository>
        <id>sonatype-nexus-staging</id>
        <name>Nexus Release Repository</name>
        <url>https://oss.sonatype.org/service/local/staging/deploy/maven2/</url>
    </repository>
</distributionManagement>

<profiles>
    <profile>
        <id>release</id>
        <activation>
            <activeByDefault>true</activeByDefault>
        </activation>
        <build>
            <plugins>
                <!--生成sources jar文件-->
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-source-plugin</artifactId>
                    <version>3.1.0</version>
                    <executions>
                        <execution>
                            <id>attach-sources</id>
                            <goals>
                                <goal>jar-no-fork</goal>
                            </goals>
                        </execution>
                    </executions>
                    <configuration>
                        <attach>true</attach>
                    </configuration>
                </plugin>
                <!--生成javadoc-->
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-javadoc-plugin</artifactId>
                    <version>3.1.1</version>
                    <executions>
                        <execution>
                            <id>attach-javadoc</id>
                            <goals>
                                <goal>jar</goal>
                            </goals>
                        </execution>
                    </executions>
                    <configuration>
                        <charset>UTF-8</charset>
                        <encoding>UTF-8</encoding>
                        <docencoding>UTF-8</docencoding>
                    </configuration>
                </plugin>
                <!--使用gpg进行签名-->
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-gpg-plugin</artifactId>
                    <version>1.6</version>
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
            </plugins>
        </build>
    </profile>
</profiles>
```

注意除了以上信息需要配置以外，我们的pom文件中的一些基本属性，例如groupId、name、url、description这些都需要补全，否则无法发布到中央仓库。

# GPG

在上一步的pom文件配置中，有一个maven-gpg-plugin插件，根据maven中央仓库的要求，所有上传的jar包必须是加密的被签名的。也就是说如果我们的jar包没有经过签名处理，最终中央仓库是不认可的。所以我们需要对我们的jar包进行加密处理。通常我们所使用的加密方法是通过GPG来对jar包进行处理（有兴趣的同学可以自行去研究一下这个GPG），这里就不展开介绍它了，我们只需要知道它是用来给我们的jar包进行加密签名的。

## 安装

如果电脑上已经安装了git桌面程序，那么我们就可以直接使用git bash来使用gpg了。如果没有安装git的话，可以通过[gpg4win](https://www.gpg4win.org/ )这个网址下载最新的安装包安装，安装完成后在命令行窗口中输入`gpg –-version`查看是否安装成功。

## 生成密钥对

在git bash中输入（如果安装了gpg4win可以在cmd命令行窗口或者通过图形化窗口来操作）

```bash
$ gpg --gen-key
```

接下来生成密钥时将需要输入name、email以及password。password在之后的步骤需要用到，请记下来。

## 上传GPG公钥

上一步我们生成密钥对后，我们需要将我们生成的公钥上传到公共的密钥服务器上，这样别人就能通过公钥服务器来验证我们的jar包是否安全，实际上sonatype就是这么做的。执行以下命令后就会列出我们的公钥和私钥

```bash
$ gpg --list-keys --keyid-format short
```

![](/images/Maven/SonaType/Gpg.png)

接下来我们就可以将我们的公钥上传到公共服务器上了

```bash
$ gpg --keyserver hkp://hkps.pool.sks-keyservers.net --send-keys 8EE2FFBB
```

上传完之后可以通过以下命令来检查公钥是否已经上传公共服务器

```bash
$ gpg --keyserver hkp://hkps.pool.sks-keyservers.net --recv-keys 8EE2FFBB
```



# 部署jar包

做好以上所有的准备工作后，我们就可以部署我们的jar包了，在git bash命令行输入以下命令

```bash
$ mvn clean deploy
```

过程中会让我们输入gpg密码，就是在生成gpg密钥对时要求我们输入的密码。等待几分钟后，jar包就会上传到[sonatype-oss](https://oss.sonatype.org)中了。

# 发布jar包

上面的步骤只是将我们的jar包部署到了一个中间缓存库中，我们还需要进行一些简单的校验工作才能将我们的jar包发布到maven中央仓库，登录[sonatype-oss](https://oss.sonatype.org)这个网站，账号密码就是我们的sonatype账号密码。

![](/images/Maven/SonaType/SonaTypeOss.png)

点击左侧的Staging Repositories，最下面的一条记录一般就是我们刚刚上传的jar包。接下来我们选中这条记录，然后点击上方的close>confirm按钮（这一步其实就是在对jar包作校验），如果校验成功，上方的release按钮就可以点击了（如果release不能点击说明校验失败了，可以对照着close过程中的信息分析失败的原因然后再重新close），然后点击这个release按钮就能够将我们的jar包发布到maven中央仓库了。过一会sonatype就会发送一个邮件通知我们，并且一开始新建的issue同时被更新了

![](/images/Maven/SonaType/Issue4.png)

根据上面的提示得知我们的jar包通常在10分钟内发布到maven中央仓库，但是如果需要在search.maven.org中搜索到我们的jar包，一般需要两个多小时。当然啦在发布成功之后我们需要在issue中通知管理员关闭这个issue，不过通不通知就是是你自己的意愿了。

# 总结

发布自己的jar包到maven中央仓库可以总结为以下几步

1. 在[sonatype-issues](https://issues.sonatype.org)上注册账号并发布一个issue，然后按照提示验证自己拥有groupId对应的域名
2. 配置maven的全局配置文件指定sonatype仓库的账号密码以及pom文件build插件的配置
3. 生成gpg密钥对并上传到公共服务器以便sonatype能够校验我们的jar包
4. 将[sonatype-oss](https://oss.sonatype.org)上我们上传的jar包close然后release，等待至多2个小时我们就能在maven仓库中搜索到我们上传的jar包

  
