# 开发指南

本指南说明网站的构建方式、源码职责和验证方法。本地启动见 [README](../README.md#本地运行)，以下命令均在仓库根目录执行。

## 构建过程与源码入口

构建读取文章及其附件，将 Markdown 渲染为完整页面，校验本地链接后写入 `dist/`。开发服务器共用内容读取、渲染和校验逻辑，在内存中提供页面；Vite 处理浏览器资源。`dist/` 是生成物，会被构建覆盖，不直接编辑或提交。

| 修改内容 | 维护位置 |
| --- | --- |
| 文章元数据与正文契约 | [src/build/content/article.ts](../src/build/content/article.ts) |
| 文章包读取、附件与排序 | [src/build/content/read.ts](../src/build/content/read.ts) |
| Markdown 文本与摘要 | [src/build/markdown/text.ts](../src/build/markdown/text.ts) |
| Markdown、目录、公式与代码高亮 | [src/build/markdown/render.ts](../src/build/markdown/render.ts)、[highlight.ts](../src/build/markdown/highlight.ts) |
| HTML 转义与原始标签处理 | [src/build/markdown/html.ts](../src/build/markdown/html.ts) |
| 页面装配、RSS 与 sitemap | [src/build/pages.ts](../src/build/pages.ts) |
| 页面壳、文章与列表模板 | [src/build/templates/](../src/build/templates/) |
| 内容与资源清单、本地链接校验 | [src/build/site.ts](../src/build/site.ts)、[src/build/links.ts](../src/build/links.ts) |
| 生产输出、开发服务器接入 | [src/build/build.ts](../src/build/build.ts)、[src/build/dev-plugin.ts](../src/build/dev-plugin.ts) |
| 浏览器增强入口 | [src/client/main.ts](../src/client/main.ts)；主题、搜索、代码复制与目录分别由同目录下的独立模块初始化 |
| 视觉与响应式样式 | [src/client/styles.css](../src/client/styles.css) 汇集 [styles/](../src/client/styles/) 中的颜色尺寸、公共背景、控件、页面壳、列表及文章样式 |
| Vite 配置和插件接入 | [vite.config.ts](../vite.config.ts) |

`public/` 保存全站资源。图标以 `public/favicon.svg` 为维护源，`favicon.ico` 和 `apple-touch-icon.png` 是由它导出的兼容文件；修改图标时同步导出这两个文件。响应头在 `public/_headers` 中维护。

代码高亮由构建时的 highlight.js 生成，浏览器仅加载对应主题样式。支持语言在 `markdown/highlight.ts` 中显式注册；无语言标记或不支持的语言保留为转义后的纯文本，不自动猜测。

## 验证与预览

执行项目验证，再启动生产产物的本地预览：

```sh
npm run verify
npm run preview
```

`verify` 执行类型检查和生产构建，并校验文章目录、元数据、本地链接、锚点及资源路径。完整命令以 [package.json](../package.json) 为准。

`preview` 使用 Workers 本地环境，在 `http://127.0.0.1:4173` 提供 `dist/` 中的页面。按本次修改检查页面内容、静态路由、响应头以及资源是否正常加载。

构建通过不能代替浏览器验证。交互或样式变化还需检查相关完整操作链、连续布局切换，以及控制台、未处理异常、资源加载和 DevTools Issues。文章应能在无 JavaScript 时阅读和打印。
