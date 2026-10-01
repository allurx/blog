# 开发指南

本指南说明网站的构建方式、源码职责和验证方法。本地启动见 [README](../README.md#本地运行)，以下命令均在仓库根目录执行。

## 构建过程与源码入口

构建读取文章及其附件，将 Markdown 渲染为完整页面，校验本地链接后写入 `dist/`。开发服务器共用内容读取、渲染和校验逻辑，在内存中提供页面；Vite 处理浏览器资源。`dist/` 是生成物，会被构建覆盖，不直接编辑或提交。

| 修改内容 | 维护位置 |
| --- | --- |
| 文章目录与元数据契约 | [src/build/content.ts](../src/build/content.ts) |
| Markdown、摘要、目录与公式 | [src/build/markdown.ts](../src/build/markdown.ts) |
| 页面模板、RSS 与 sitemap | [src/build/pages.ts](../src/build/pages.ts) |
| 内容与资源清单、本地链接校验 | [src/build/site.ts](../src/build/site.ts)、[src/build/links.ts](../src/build/links.ts) |
| 生产输出、开发服务器接入 | [src/build/build.ts](../src/build/build.ts)、[src/build/dev-plugin.ts](../src/build/dev-plugin.ts) |
| 浏览器交互与样式 | [src/client/main.ts](../src/client/main.ts)、[src/client/styles.css](../src/client/styles.css) |
| Vite 配置和插件接入 | [vite.config.ts](../vite.config.ts) |

`public/` 保存全站资源。图标以 `public/favicon.svg` 为维护源，`favicon.ico` 和 `apple-touch-icon.png` 是由它导出的兼容文件；修改图标时同步导出这两个文件。响应头在 `public/_headers` 中维护。

## 验证与预览

执行项目验证，再启动生产产物的本地预览：

```sh
npm run verify
npm run preview
```

`verify` 执行类型检查和生产构建，并校验文章目录、元数据、本地链接、锚点及资源路径。完整命令以 [package.json](../package.json) 为准。

`preview` 使用 Workers 本地环境，在 `http://127.0.0.1:4173` 提供 `dist/` 中的页面。按本次修改检查页面内容、静态路由、响应头以及资源是否正常加载。

构建通过不能代替浏览器验证。交互或样式变化还需检查相关完整操作链、连续布局切换，以及控制台、未处理异常、资源加载和 DevTools Issues。文章应能在无 JavaScript 时阅读和打印。
