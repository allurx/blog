# allurx 的个人博客

[阅读博客](https://blog.allurx.io) · [文章归档](https://blog.allurx.io/archives/) · [RSS 订阅](https://blog.allurx.io/rss.xml)

记录与分享计算机相关知识，从基础原理到软硬件技术、工程实践与应用。每篇文章围绕一个明确的学习目标展开，并说明所需的前置知识。

本仓库维护博客文章、随文附件和网站源码。文章以 Markdown 编写，网站使用 TypeScript 与 Vite 构建，由 GitHub Actions 验证和部署到 Cloudflare Workers。

## 阅读体验

- **查找与订阅**：按关键词搜索文章、按领域筛选，通过归档浏览历史内容，使用 RSS 订阅更新。
- **技术内容呈现**：提供文章目录、代码高亮与复制、数学公式，代码和表格在各自区域内横向滚动。
- **阅读设置**：适配桌面和窄屏，支持浅色、深色和跟随系统的主题。
- **静态页面**：正文、目录和文章链接在构建时写入 HTML，无 JavaScript 时仍可阅读、跳转章节和打印。

## 本地运行

安装 Git 和 [.node-version](.node-version) 指定的 Node.js，然后克隆仓库并启动开发服务器：

```sh
git clone https://github.com/allurx/blog.git
cd blog
npm ci
npm run dev
```

打开终端输出的本地地址，修改文章或浏览器资源后会自动刷新。已有本地仓库时，直接在仓库根目录执行后两条命令。

站点名称、作者和公开地址在 [site.config.ts](site.config.ts) 中配置；构建验证、生产预览和部署设置见下方指南。

## 使用与维护

| 要做的事           | 文档                                                                |
| ------------------ | ------------------------------------------------------------------- |
| 新增或修订文章     | [写作指南](docs/writing.md)：文章格式、组织与表达、来源、示例及附件 |
| 修改网站           | [开发指南](docs/development.md)：构建过程、源码入口、验证与预览     |
| 发布网站           | [发布指南](docs/deployment.md)：自动发布、手动发布与结果查看        |
| 调整定时与手动写作 | [任务定义](automation/daily-blog.md)：执行规则、失败恢复与发布核验  |

## 许可证

网站源码（包括页面构建工具、浏览器脚本、样式和工程配置）采用 [Apache License 2.0](LICENSE.txt)。

`articles/` 中的文章和随文内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。引用的第三方代码、图片及项目依赖遵循各自许可，保留署名与版权信息。
