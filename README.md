# allurx 的博客

面向软件工程读者的技术博客。Markdown 是内容源，TypeScript 在构建时生成完整 HTML；浏览器脚本提供搜索、主题和代码复制，文章可以在无 JavaScript 环境中阅读和打印。

## 本地开发

使用 Node.js 24 或更新版本：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。文章、页面和浏览器资源修改后会自动刷新。

```sh
npm run verify
npm run preview
```

`verify` 执行类型检查、测试和生产构建。`dist/` 是唯一的构建输出，`preview` 使用 Workers 本地环境验证静态路由与响应头，地址为 `http://127.0.0.1:4173`。

## 写作

文章保存在 `content/articles/YYYY-MM/`，使用 YAML 元数据和自由组织的 Markdown 正文：

```md
---
title: 为什么 volatile 不能保证自增原子性
date: 2026-09-07
id: 2026-09-07-java-volatile-increment-lost-update
domain: Java
tags: [Java, Concurrency, Volatile]
---

两个线程同时对同一个 volatile 变量执行自增，结果仍可能丢失更新。问题出在读取、计算和写回之间的交错。

## 可见性并不合并三个操作

如果两个线程都读到 0，各自计算出 1 再写回，最终结果就是 1。
```

- `title`、`date`、`id`、`domain` 和字符串数组 `tags` 必须提供。标签不带 `#`。
- 新文章的 `id` 使用日期加小写英文主题标识，文件名为 `ID.md`，默认地址为 `/articles/ID/`。
- 修订时保留原日期和 ID，并将可选的 `updated` 写为实际修订日期。正文标题从二级开始，文章标题由页面模板生成。

文章应围绕具体问题自然展开，说明必要的版本、示例前提、证据和取舍。没有固定章节或字数要求；格式检查不能替代内容审阅。历史源码分析仍以各文标明的版本背景为准。

关于页位于 `content/pages/about.md`。公开图片放在 `public/images/`，文章附件放在 `public/articles/ID/`，正文使用实际可访问的相对链接。数学公式在构建时生成 MathML。

文章新增与修订都直接编辑正式内容源，通过 Git 记录变更。正文与所需附件应在同一次提交中保存。

## 发布与每日写作

直接在 `main` 维护。GitHub 仓库 `allurx/blog` 是正式内容源；Cloudflare Workers Builds 跟随 `main`，执行 `npm run verify`，再用 `npx wrangler deploy` 发布静态产物。站点地址由 [site.config.ts](site.config.ts) 维护，部署与自定义域名配置在 [wrangler.jsonc](wrangler.jsonc)。

云端“每日博客文章”任务每天北京时间 08:00 读取仓库中的[任务定义](automation/daily-blog.txt)，完成写作、核验、提交和发布检查。资料库保留既有历史档案，不再维护另一套文章索引及周/月汇总。任务指令已保存、GitHub 已提交、构建通过和网页已更新是不同阶段，应分别确认。

必要时可使用 `npm run deploy` 手动校验并发布；需要已获相应权限的 Cloudflare 登录。平台操作见 [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)、[Workers Builds Git 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)和[自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

## 开发入口

- `scripts/content.ts`：文章读取、元数据和链接契约。
- `scripts/markdown.ts`：正文、摘要、目录、公式与 HTML 边界。
- `scripts/pages.ts`：页面、RSS 和 sitemap。
- `scripts/build.ts`：资源构建与最终文件写入；`vite.config.ts` 接入开发服务器。
- `src/main.ts`、`src/styles.css`：浏览器交互和阅读样式。

文章延续原站的 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)声明。依赖自身的许可见各包。
