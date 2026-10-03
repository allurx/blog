# 开发指南

本指南面向修改网站实现的维护者，说明构建边界、源码入口和验证方法。文章内容遵循[写作指南](writing.md)，本地启动见 [README](../README.md#本地运行)，以下命令均在仓库根目录执行。

## 工具与检查基线

使用 [.node-version](../.node-version) 指定的 Node.js 版本线及 `npm ci` 安装锁定依赖。Prettier 负责排版，ESLint 检查代码语义，TypeScript 分别检查浏览器与 Node.js 环境；具体规则由 [package.json](../package.json)、[ESLint 配置](../eslint.config.mjs) 和 [TypeScript 配置](../tsconfig.json) 维护。

`npm run format` 修改工程文件格式；文章及附件、依赖、构建输出和本地工作目录由 [.prettierignore](../.prettierignore) 排除。工程文本统一使用 LF，`articles/` 保留原始字节。迭代时可分别运行 `format:check`、`lint`、`type-check`，`npm run check` 按该顺序完成只读静态检查。

浏览器代码使用 DOM 类型和 Vite 的模块解析，构建脚本使用 Node.js 类型及 `NodeNext`，并限制为 Node.js 可直接执行的可擦除 TypeScript 语法。第三方声明仍可能传递引入 DOM 类型，因此 Node.js 入口另通过 lint 禁止页面和客户端状态 API；这不限制 Node.js 原生支持的 `fetch`、`URL` 和定时器。依赖更新由 [Dependabot](../.github/dependabot.yml) 每周提出：npm 的 minor、patch 更新分组，大版本单独审查。TypeScript 暂保持 6.0 系列；升级版本线前核对 [typescript-eslint 的支持范围](https://typescript-eslint.io/users/dependency-versions/)，不要让类型感知 lint 使用未经支持的编译器。

支持桌面与移动端主流常青浏览器的当前及前一个稳定大版本。JavaScript 构建目标显式设为 `es2023`，避免 Vite 升级隐式改变语法目标；这不等同于 Web API 支持保证，剪贴板、弹出层等增强仍须检测实际能力。验证保留无 JavaScript 阅读、打印及下文列出的完整操作链。

## 构建过程与源码入口

构建读取文章及其附件，将 Markdown 渲染为完整页面，校验本地链接后写入 `dist/`。开发服务器共用内容读取、渲染和校验逻辑，在内存中提供页面；Vite 处理浏览器资源。`dist/` 是生成物，会被构建覆盖，不直接编辑或提交。

| 修改内容                       | 维护位置                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文章元数据与正文契约           | [scripts/content/article.ts](../scripts/content/article.ts)                                                                                                       |
| 文章包读取、附件与排序         | [scripts/content/read.ts](../scripts/content/read.ts)                                                                                                             |
| 领域分组与细分名称             | [scripts/content/domains.ts](../scripts/content/domains.ts)；列表模板按实际文章计数，未列入分组的领域仍可筛选                                                     |
| Markdown 文本与摘要            | [scripts/markdown/text.ts](../scripts/markdown/text.ts)                                                                                                           |
| Markdown、目录、公式与代码高亮 | [scripts/markdown/render.ts](../scripts/markdown/render.ts)、[highlight.ts](../scripts/markdown/highlight.ts)                                                     |
| HTML 转义与原始标签处理        | [scripts/markdown/html.ts](../scripts/markdown/html.ts)                                                                                                           |
| 页面装配、RSS 与 sitemap       | [scripts/pages.ts](../scripts/pages.ts)                                                                                                                           |
| 页面壳、文章与列表模板         | [scripts/templates/](../scripts/templates/)；`shell.ts` 生成元信息和 JSON-LD，品牌、作者和站点地址来自 [site.config.ts](../site.config.ts)                        |
| 内容与资源清单、本地链接校验   | [scripts/site.ts](../scripts/site.ts)、[scripts/links.ts](../scripts/links.ts)                                                                                    |
| 生产输出、开发服务器接入       | [scripts/build.ts](../scripts/build.ts)、[scripts/dev-plugin.ts](../scripts/dev-plugin.ts)                                                                        |
| 浏览器增强                     | [src/main.ts](../src/main.ts) 初始化主题、搜索、代码复制、目录和页面工具，各功能由同目录中的模块维护                                                              |
| 页面壳、列表与文章布局         | [src/styles.css](../src/styles.css) 汇集 [src/styles/](../src/styles/) 中的颜色尺寸、公共背景、控件及页面样式                                                     |
| 正文排版、代码与表格           | [src/styles/prose.css](../src/styles/prose.css)                                                                                                                   |
| 文章目录与当前章节状态         | [src/styles/toc.css](../src/styles/toc.css)、[src/article-toc.ts](../src/article-toc.ts)                                                                          |
| 共享竖向工具栏与原生折叠       | [scripts/templates/tools.ts](../scripts/templates/tools.ts)、[src/page-tools.ts](../src/page-tools.ts)、[src/styles/page-tools.css](../src/styles/page-tools.css) |
| 首屏画布与主题颜色             | [src/styles/initial-theme.css](../src/styles/initial-theme.css) 在页面头部内联，避免外部样式加载前出现错误的背景颜色                                              |
| Vite 配置和插件接入            | [vite.config.ts](../vite.config.ts)                                                                                                                               |

`public/` 保存全站资源。图标以 `public/favicon.svg` 为维护源，`favicon.ico` 和 `apple-touch-icon.png` 是由它导出的兼容文件；修改图标时同步导出这两个文件。响应头在 `public/_headers` 中维护。

代码高亮由构建时的 highlight.js 生成，浏览器仅加载对应主题样式。支持语言在 [scripts/markdown/highlight.ts](../scripts/markdown/highlight.ts) 中显式注册；无语言标记或不支持的语言保留为转义后的纯文本，不自动猜测。高亮支持范围不限制文章选题或示例语言。

## 阅读界面

正文、目录和文章链接在构建时写入 HTML，浏览器脚本只增强操作体验。文章保持自然文档滚动和原生锚点，不以脚本接管正文路由、章节内容或阅读进度。桌面与窄屏共用一份正文和目录语义，代码和表格在各自区域内处理溢出。

文章列表、归档和详情的主体面板共用宽度与左右对齐线，窄屏页面使用全部可用宽度。页面工具在文档流之外悬浮，纵向分组排列，可展开和折叠，移动端默认折叠；正文不为工具预留额外内边距。列表提供归档入口，归档提供列表入口，详情另提供目录；各页都能前往顶部和底部。目录使用原生弹出层，每次打开定位当前章节，展开期间的正文滚动只更新章节标记，不强制移动目录列表。工具与目录开合都不改变正文宽度或阅读位置。

目录从 Markdown 解析出的标题生成，保留原有顺序和级别，不限制正文标题的起始级别，也不要求连续使用各级标题。标题跳级时依附最近的较浅标题，没有父标题时作为顶层入口；正文没有标题时不显示目录。文章组织由内容决定，解析器不通过校验或过滤来规定写作结构。

这些交互参考 Aura Reader 的竖向工具栏、侧边目录和独立滚动区域。博客仍以独立网页阅读为基础，不引入书库、分页或阅读器业务状态。没有 JavaScript 时，正文、链接与原生目录开关仍然可用。

代码复制仅使用 Clipboard API，在安全上下文且浏览器支持时显示复制按钮。正式 HTTPS 站点和本机 `localhost` 可使用该功能；局域网 HTTP 预览保留原生选择和手动复制。开合和操作反馈遵循减少动态效果偏好。

正文、文章标题、元数据、代码、表格和输入框保留原生文字选择；导航与操作控件避免拖动误选。弹层动效由自身的层级容器承担，验证时检查进入和退出的中间帧，避免动画祖先临时改变堆叠顺序，或用裁切容器截断圆角阴影。

## 验证与预览

执行项目验证，再启动生产产物的本地预览：

```sh
npm run verify
npm run preview
```

`verify` 执行一次格式、lint、类型检查和生产构建，并校验文章目录、元数据、本地链接、锚点及资源路径。GitHub Actions 使用相同命令和 [.node-version](../.node-version) 指定的 Node.js；部署阶段直接使用本次验证产物。完整命令以 [package.json](../package.json) 为准。

`preview` 使用 Workers 本地环境，在 `http://127.0.0.1:4173` 提供 `dist/` 中的页面。并行预览其他工程时，可用 `npm run preview -- --port 4175` 覆盖端口。按本次修改检查页面内容、静态路由、响应头以及资源是否正常加载。

构建通过不能代替浏览器验证。根据受影响的功能，检查以下完整操作链：

- 文章在桌面和窄屏下均可阅读，连续调整宽度并往返跨越布局切换点，检查正文、目录、工具及局部溢出。
- 从文章中部打开目录，定位并跳转章节，重新打开后检查当前章节与焦点；覆盖关闭、取消和返回正文的过程，并验证顶部、底部和列表入口。
- 搜索、主题切换或代码复制发生变化时，覆盖输入、操作结果、再次使用及页面返回，检查应保留和应重置的状态。
- 检查键盘操作、无 JavaScript 阅读与原生目录跳转、打印页面；检查控制台错误和警告、未处理异常、资源加载失败及 DevTools Issues。

验证以最终产物和实际可观察结果为准。不能运行的场景明确报告原因与影响，不将类型检查或构建通过表述为浏览器验证完成。发布核验见[发布指南](deployment.md)。
