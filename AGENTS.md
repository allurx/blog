# 博客工程约束

本仓库是 `allurx/blog` 的源码，采用 TypeScript、HTML、CSS 生成静态博客。版本和命令以 [package.json](package.json)、[.node-version](.node-version)及 [README.md](README.md)为准。

## 维护与内容

- 直接在 `main` 开发和更新文章，不创建任务分支或 PR。保留已有修改，提交只包含已经核验的任务内容。
- GitHub 仓库是文章的唯一正式维护源。云端每日任务的维护文本在 [automation/daily-blog.txt](automation/daily-blog.txt)，调度仍由既有云端任务承担；修改文件后须同步核对实际任务的入口指令与日程。
- 文章统一放在 `content/articles/YYYY-MM/`，格式见 [README.md](README.md#写作)，契约由 [scripts/content.ts](scripts/content.ts)校验。保留原发表日期，所有文章以稳定 ID 生成 `/articles/ID/` 地址，不再兼容旧站路径；目录名不决定文章 URL。
- 文中属于作者本人的署名、示例包名和个人标识统一为 `allurx`，Java 示例命名空间使用 `io.allurx`；保留他人署名和版权信息。
- 文章面向读者自然展开，不使用研究强度或固定八节模板。完整示例应具备复现条件，实际执行过才称验证通过；历史代码按各文版本背景解释，不因迁移或重建就声称已经升级验证。
- 文章新增与修订直接编辑正式内容源，通过 Git 审阅和记录变更。每日任务遇到同日或 ID 冲突时核对已有文章，不另写重复文章；修订保留身份和原发表日期，以 `updated` 标明实际修订日期。
- 每日完成一篇正式文章，直接提交 main 并发布，不建立草稿或待审核流程。图片和附件维持已有公开路径；只使用真实取得的正文与附件，不从聊天摘要重建文章，不以云端临时路径充当稳定链接。
- 资料库保留历史档案，不再维护并行私有索引或周/月汇总；不删除这些档案，除非用户另行明确要求。
- 不接入评论服务，不操作评论仓库或外部评论资源。

## 实现与验证

- 正文、目录和文章链接在构建时写入 HTML，浏览器 TypeScript 只做渐进增强。保留自然文档滚动、原生锚点、无 JavaScript 阅读和打印。
- 桌面与窄屏共用内容和语义结构；目录、代码和表格只按实际空间处理局部溢出，不引入应用式阅读器状态。
- `scripts/content.ts` 处理内容契约，`scripts/markdown.ts` 处理 Markdown，`scripts/pages.ts` 生成文档，`scripts/build.ts` 编排构建。Vite 负责浏览器资源与开发刷新，避免新增重复构建路径或中间 HTML 目录。
- 修改后执行 `npm run verify`。交互或样式变化还需实际浏览器验证完整操作链、连续布局切换、控制台、未处理异常、资源加载和 DevTools Issues。
- `dist/` 是唯一正式构建输出，不提交。`node_modules/`、`.wrangler/` 为可重建依赖与本地状态。任务临时稿、迁移脚本、截图及核验过程文件不加入源码或运行依赖；交付前清理失效产物，保留必要的最终交付证据。

## 发布

- 使用 Cloudflare Workers 静态资源和 Workers Builds，从 `main` 发布到 `allurx.io`。域名以 [site.config.ts](site.config.ts) 为准，平台配置以 [wrangler.jsonc](wrangler.jsonc) 为准，不再使用 Pages 链路。
- 每日任务按当日日期去重，正文与必需附件在一次 Git 提交中保存；不强推、不改写历史。推送结果不明确时先回读目标文件与提交，再决定是否重试。
- Git 提交、构建、部署和公开页面分别取得证据。失败时保留已保存成果，明确未完成阶段，不能把旧页面可访问等同于新版本已发布。
