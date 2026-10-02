# allurx 的博客

面向软件工程读者的静态博客，站点地址配置为 [blog.allurx.io](https://blog.allurx.io)。文章以 Markdown 维护，构建时生成完整 HTML；浏览器脚本提供搜索、主题和代码复制，无 JavaScript 时仍可阅读和打印。

## 本地运行

安装 [.node-version](.node-version) 指定的 Node.js，在仓库根目录执行：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`，修改文章或浏览器资源后会自动刷新。

## 使用与维护

| 要做的事 | 文档 |
| --- | --- |
| 新增或修订文章 | [写作指南](docs/writing.md)：文章格式、组织与表达、来源、示例及附件 |
| 修改网站 | [开发指南](docs/development.md)：构建过程、源码入口、验证与预览 |
| 发布网站 | [发布指南](docs/deployment.md)：自动发布、手动发布与结果查看 |
| 调整每日自动写作 | [每日任务定义](automation/daily-blog.md)：选题、去重、保存与交付流程。执行日程在既有云端任务中维护 |

## 许可证

文章延续原站的 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)声明。依赖自身的许可见各包。
