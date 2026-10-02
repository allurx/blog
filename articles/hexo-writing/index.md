---
title: 用 Hexo 与 NexT 建立可维护的博客
date: 2018-10-02
updated: 2026-10-02
tags: [Hexo, NexT, 静态网站]
domain: Hexo
---

Hexo 把 Markdown 文章、站点配置和主题模板生成静态网页。写作时维护源文件，发布时交付生成目录；这两个目录承担不同职责，不能只保存生成后的 HTML。

下面以 Hexo 8 和 NexT 8 为例，从创建项目走到文章、分类导航和本地预览。Hexo 8 要求 Node.js 不低于 20.19.0，这里使用 Node.js 24，并准备好 Git。[Hexo 安装要求](https://hexo.io/zh-cn/docs/#Node-js-版本限制)

## 创建项目并固定依赖

先安装命令行入口，再创建站点。`hexo-cli` 提供命令入口，项目中的 `hexo` 包负责实际生成页面：

```sh
npm install -g hexo-cli
hexo init my-blog
cd my-blog
npm install
npm install --save-exact hexo@8.1.2 hexo-theme-next@8.29.0
```

以下命令均在 `my-blog` 根目录执行。把 `package.json` 和 `package-lock.json` 一起纳入版本控制，其他环境通过 `npm ci` 安装同一组依赖。升级时明确修改版本并检查页面，不让不同机器各自选择不同的主题版本。

Hexo 的 `_config.yml` 保存站点设置，将其中已有的 `theme` 改为 `next`。通过 npm 安装主题时，不需要再向 `themes/next` 克隆第二份主题。[NexT 安装](https://theme-next.js.org/docs/getting-started/)

在项目根目录创建 `_config.next.yml`，写入主题覆盖配置：

```yaml
scheme: Gemini
```

站点配置和主题配置是两份文件：`_config.yml` 选择主题，`_config.next.yml` 定制 NexT。不要直接改 `node_modules` 中的配置，重新安装依赖会覆盖它。[NexT 配置方式](https://theme-next.js.org/docs/getting-started/configuration.html)

## 写一篇文章

创建文章：

```sh
npx hexo new post "第一篇文章"
```

命令会在 `source/_posts/` 下生成 Markdown。保留生成的日期，补充标题、分类、标签和正文，例如：

```md
---
title: 理解进程与线程
date: 2026-10-02 10:00:00
categories:
  - 操作系统
tags:
  - 进程
  - 线程
---

进程为程序提供资源与隔离边界，线程描述进程内的执行流。

## 为什么一个进程可以有多个线程

多个执行流可以共享进程的地址空间，但仍需要同步对共享数据的访问。
```

分类用来组织文章，标签用来建立交叉入口。给文章填写这些字段不等于已经在主题导航中启用了分类页和标签页，还需要创建对应页面。[Hexo 写作](https://hexo.io/zh-cn/docs/writing)

## 建立分类和标签导航

执行：

```sh
npx hexo new page categories
npx hexo new page tags
```

分别编辑两个文件。`source/categories/index.md` 的元数据为：

```yaml
---
title: 分类
type: categories
---
```

`source/tags/index.md` 的元数据为：

```yaml
---
title: 标签
type: tags
---
```

然后在 `_config.next.yml` 中加入菜单，保留前面设置的 `scheme`：

```yaml
menu:
  home: / || fa fa-home
  tags: /tags/ || fa fa-tags
  categories: /categories/ || fa fa-th
  archives: /archives/ || fa fa-archive
```

这里有三层关系：文章元数据产生分类与标签，页面声明决定显示什么，主题菜单提供入口。只改菜单而没有创建页面，会得到一个无法使用的导航链接。[NexT 自定义页面](https://theme-next.js.org/docs/theme-settings/custom-pages.html)

## 预览、构建与保存

先生成静态文件，再预览：

```sh
npx hexo generate --bail
npx hexo server
```

浏览器打开终端给出的地址，默认是 `http://localhost:4000/`。检查首页能否进入文章、分类页是否包含文章、标签链接能否返回相应列表，并确认图片和代码块显示正常。修改配置后如需清理缓存，执行 `npx hexo clean` 后重新生成；它会清除缓存及 `public/`，不要把手工文件保存在生成目录。[Hexo 命令](https://hexo.io/zh-cn/docs/commands)

版本库保存文章、配置、主题覆盖文件和依赖清单，忽略 `node_modules/`、`public/` 与 `db.json`。发布到静态托管服务时交付 `public/` 的内容；`hexo server` 是本地预览服务，不能代替正式的静态托管配置。
