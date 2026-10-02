---
title: 使用Hexo撰写博客
date: 2018-10-02
tags:
  - Hexo
domain: Hexo
---

## 核心结论

Hexo 将 source/_posts 中的 Markdown 与主题模板构建为静态页面，写作内容和展示模板可以分别维护。标签、分类、关于页需要相应页面与主题导航配置；hexo generate 生成文件，hexo server 仅用于本地预览。

## 问题与适用范围

本文回答：怎样用 Hexo 把 Markdown 文章生成静态博客，并建立基本导航？

本文保留 2018 年使用 Hexo 与 NexT 搭建博客的历史场景。旧主题配置和安装方式需要按所选主题版本核对，本文不作为当前博客工程的开发入口；当前工程操作以仓库 README 为准。

## 概述

作为一名java程序员，如果平时想要写点笔记文章来记录学习的历程，就需要自己去编写html，js，css代码。苦于自己前端技术停留在使用jquery，js，css的层面，让人十分的苦恼。最近在网上搜索相关的博客框架时，发现了一款十分炫酷的静态博客框架[Hexo](https://hexo.io)，只需要使用Markdown语言编写博客内容，hexo就可以将md文件生成html页面。使用hexo可以让我们这些不擅长前端技术的人快速搭建起属于自己的博客网站。

<!-- more -->

## 前期准备

在电脑上安装以下软件：

1. Git
2. Node.js
3. Hexo

具体的安装步骤就不累赘了，可以参考[hexo官方文档](https://hexo.io/zh-cn/docs/)官方文档。
## 初始化hexo工程

```sh
$ hexo init blog
$ cd blog
$ npm install
```
执行完这个命令，就会在当前路径下生成一个blog文件夹，一个hexo工程就初始化完毕了。
## 修改hexo主题

hexo使用的默认主题页面不是特别好看，推荐一个个人比较喜欢的主题[hexo-theme-next主题](https://theme-next.js.org/)。这是next主题的官网，具体介绍可以去官网查看。

### 下载hexo-theme-next主题

``` sh
$ cd blog
$ git clone https://github.com/next-theme/hexo-theme-next.git ./themes/next
```
### 修改hexo配置文件

```sh
$ vim _config.yml
```
将`theme: next`主题属性修改为next

## 新建categories(分类)，tags（标签）菜单

在hexo中可以生成一些分类、标签、归档等菜单，这些菜单本质上也是页面，需要我们手动初始化，执行以下命令生成这些页面
```sh
$ hexo new page categories
$ hexo new page tags
$ hexo new page about
```
生成的md文件存放在hexo工程下的source文件夹内，编辑对应的md文件
```markdown
---
title: categories
type: "categories"
comments: false

---

---
title: tags
type: "tags"
comments: false

---
```
以后我们只需要将编写的博客md文件放在source/_posts文件夹下，hexo会自动将它们渲染成html页面

### 修改next主题配置文件

```sh
$ vim themes/next/_config.yml
```
将我们刚刚新建的菜单开启
```yaml
# 菜单设置
menu:
  home: / || home
  about: /about/ || user
  tags: /tags/ || tags
  categories: /categories/ || th
  archives: /archives/ || archive

```
修改next布局方案
```yaml
# Schemes
#scheme: Muse
#scheme: Mist
#scheme: Pisces
scheme: Gemini
```
## 启动hexo

```sh
$ hexo g && hexo server
```
生成页面并启动服务器，默认情况下，访问网址`http://localhost:4000/`即可访问博客页面。

## 资料来源

- [Hexo 官方简体中文文档](https://hexo.io/zh-cn/docs/)
- [NexT 安装与配置](https://theme-next.js.org/docs/getting-started/)
