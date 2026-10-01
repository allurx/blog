# 发布指南

网站使用 Cloudflare Workers 静态资源和 Workers Builds 发布。GitHub 仓库 `allurx/blog` 的 `main` 是正式维护源，站点信息见 [site.config.ts](../site.config.ts)，部署与自定义域名配置见 [wrangler.jsonc](../wrangler.jsonc)。

## 自动发布

按[开发指南](development.md#验证与预览)完成验证后，将改动提交并推送到 `main`。既有 Workers Builds 会执行 `npm run verify`，再使用 `npx wrangler deploy` 发布构建产物。正文与必需附件应在同一次提交中保存。

在 Cloudflare 对应 Worker 的 Builds 中找到该次 commit，查看构建结果；再到 Deployments 核对部署。最后访问本次受影响的公开页面，检查标题、日期、关键正文和附件，确认展示的是这次改动。

构建、部署和公开内容分别核对。失败时保留已保存成果，按实际失败阶段继续处理，不用重新生成文章补偿发布失败。

## 手动发布

先按 [README](../README.md#本地运行) 准备运行环境与依赖，并完成具备相应权限的 Cloudflare 登录。在仓库根目录执行：

```sh
npm run deploy
```

该命令先运行项目验证，再执行部署。完成后同样核对对应部署和公开页面。

平台配置方法见 [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)、[Git 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)和[自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。
