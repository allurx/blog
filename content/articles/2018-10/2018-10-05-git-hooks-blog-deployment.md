---
title: 利用Git-Hook动态发布博客
date: 2018-10-05
updated: 2026-10-01
id: 2018-10-05-git-hooks-blog-deployment
tags:
  - Hexo
  - Git
  - Git-Hook
domain: Hexo
---

## 核心结论

服务端裸仓库的接收 hook 可以把指定版本的内容导出到博客构建目录，再生成静态文件，由 Web 服务器提供访问。内容版本管理、构建和公开发布分别是不同阶段；推送完成并不能独自证明构建和线上页面更新成功。

## 问题与适用范围

本文回答：自有服务器如何在接收博客内容的 Git 推送后重新生成静态站点？

本文保留 2018 年自有 Linux 服务器、Bash、Hexo 与 nginx 的历史部署场景。下面脚本会替换指定 source 目录中的内容，只适用于已核对的专用构建目录，不能直接用于保存其他数据的目录；原路径与 Node.js 版本也是当时环境的示例。当前博客部署方式以仓库 README 为准。

## 概述

平时在写博客的时候经常会遇到昨天晚上在家里写好了一半的文章，第二天来到公司想要接着昨天晚上的博客继续写，这是一件很苦恼的事。就像我们平时写代码一样，需要多人协作在不同的地方同时开发一样，为了解决这个问题，人们引入了版本控制的概念，本篇文章为了解决这个问题，通过使用git来对博客内容进行管理，利用git-hook动态发布博客，达到多台电脑编写文章并且能够快速部署博客的目的。

<!-- more -->

## 在服务器端初始化blog的hexo工程

创建流程参见[使用Hexo撰写博客](/articles/2018-10-02-hexo-blog-writing/)。

## 在服务器端初始化blog的git裸仓库

```sh
$ mkdir blog.git
$ cd blog.git
$ git init --bare
```
### 编辑该git仓库的post-update脚本

``` sh
$ cd blog.git/hooks
$ mv post-update.sample post-update
$ chmod +x post-update
$ vim post-update
```
修改内容如下：
``` sh
#!/usr/bin/env bash

set -e

# git在执行hook的时候会修改环境变量,导致找不到相关的命令
# 我们手动添加一些需要的环境变量或者指定需要执行命令的全路径

# 将hexo命令所在的路径添加到PATH中
PATH=/root/node-v10.16.0/bin:$PATH

# hexo工程目录
blogPath=/root/blog/

# hexo工程的source目录
blogContentPath=/root/blog/source/

# 归档文件名
archivedFile=latest.tar.gz

# 将最新提交的文件归档到hexo工程的source目录下
git archive -o "$blogContentPath$archivedFile" HEAD

# 使用Bash扩展模式匹配，包含隐藏文件并使空匹配不保留为字面量
shopt -s extglob dotglob nullglob

# 删除之前的博客文件并且解压刚刚归档的仓库最新文件最后再删除归档文件
cd "$blogContentPath" && rm -rf -- !("$archivedFile") && tar -xzf "$archivedFile" && rm -- "$archivedFile"

# 清除hexo缓存文件(db.json)和已生成的静态文件(public)并且重新生成静态文件
cd "$blogPath" && hexo clean && hexo g

```
这个脚本的作用是在客户端执行git push操作时，将最新的博客内容打包复制到上一步创建的hexo工程source文件夹下，然后执行`hexo clean && hexo g`命令，这样只要对博客内容进行了修改，服务器上hexo的内容就会自动重新生成。
并且由于我是通过nginx对hexo生成的public文件夹做了静态映射，所以这里没有启动hexo服务，如果服务器上没有安装nginx，可以在最后一步加上hexo server来启动hexo服务

## 在客户端初始化blog的hexo工程

创建流程参考上一篇如何使用hexo撰写博客的文章，hexo工程创建好之后，进入到source文件夹下，执行以下命令对该文件夹下所有文件进行git仓库初始化并关联服务端仓库。
``` sh
$ cd source
$ git init
$ git add .
$ git commit -m "初始化提交"
$ git remote add origin https://xxx/blog.git
```
最终的目录结构如下：
![](/images/Hexo/Source-Directory-Structure.png)

这样以后我们只需要在source文件下进行md文件的编写，然后执行git push操作就会触发我们刚刚编写的post-update脚本，从而实现自动部署。

至此，所有步骤已经完成，接下来我们测试一下：
1. 在_posts文件夹下添加一个md文件，编写一些内容

2. 将新增的文件推送到远程服务器

   ```sh
   $ git add .
   $ git commit -m "新增文章" && git push origin master
   ```

3. 检查服务端hook输出与构建产物，再刷新对应页面，确认文章已由Web服务器提供访问。

## 资料来源

- [Git hook 官方说明](https://git-scm.com/docs/githooks)
- [Git archive 官方说明](https://git-scm.com/docs/git-archive)
- [Hexo 命令](https://hexo.io/zh-cn/docs/commands)
