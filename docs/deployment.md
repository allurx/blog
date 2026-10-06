# 发布指南

网站使用 Cloudflare Workers 静态资源托管，GitHub Actions 负责验证和自动部署。GitHub 仓库 `allurx/blog` 的 `main` 是正式维护源，站点信息见 [site.config.ts](../site.config.ts)，Worker、产物目录和自定义域名统一在 [wrangler.jsonc](../wrangler.jsonc) 中维护。本文说明已获授权的发布操作；只要求修改文件时，不据此执行提交、推送或部署。

## 首次配置

1. 创建 GitHub `production` Environment，仅允许 `main` 部署。
2. 在该环境的 Variables 中设置 `CLOUDFLARE_ACCOUNT_ID`，并在 Secrets 中保存 `CLOUDFLARE_API_TOKEN`。使用本项目独立的 token，按目标账户和 `allurx.io` 区域限定 Worker 部署及自定义域名所需的权限。Custom Domains 当前不支持按单个 Worker 限定角色，不能用仅限单 Worker 的权限替代域名管理所需授权；具体范围见 [Workers 权限说明](https://developers.cloudflare.com/workers/authorization/workers/)。
3. 确认账户中已存在配置所指向的 Worker，域名所属区域已托管在该账户中。域名、`workers.dev` 和预览 URL 的设置以 Wrangler 配置为准，避免在控制台另行维护冲突值。
4. 从 Workers Builds 切换时，先准备好上述凭据及 [CI 工作流](../.github/workflows/ci.yml)，完成首次 Actions 部署及公开页面核验，再停用原 Worker 的 Workers Builds Git 触发器。确认后续推送只由 Actions 自动部署，不保留两套常驻发布入口。

配置方法见 [GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[Wrangler 配置来源](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)和[自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

## 自动发布

按[开发指南](development.md#验证与预览)完成验证后，将已核验的改动提交并推送到 `main`。正文与必需附件在同一次提交中保存。定时与手动写作任务还须遵循[任务定义](../automation/daily-blog.md)的提交标记和恢复规则；其他文章正常发布，不受当天文章数量限制。

[`CI` 工作流](../.github/workflows/ci.yml) 调用 [Web Foundation 静态站点工作流](https://github.com/allurx/web-foundation/blob/main/docs/deployment.md)，对 PR 和 `main` 推送执行 `npm run verify` 与部署配置 dry-run，仅 `main` 推送进入 `production` 部署。调用参数保留博客的 `dist/` 产物目录和公开地址，Worker 与域名仍由本工程的 Wrangler 配置维护。基础包与共享工作流固定到同一个不可变发布的具体版本标签，更新时保持两处一致。调用通过 `secrets` 显式映射唯一的 `CLOUDFLARE_API_TOKEN`，部署 job 仍绑定 `production` 环境。Node.js 版本由 [.node-version](../.node-version) 统一指定。

在 GitHub Actions 中找到本次 commit 对应的 `CI` 运行，确认 `site / verify` 通过且 `site / deploy` 实际执行成功；再到 Cloudflare Worker 的 Deployments 核对版本，版本 tag 为 commit SHA，message 链接本次 Actions 运行。最后访问本次受影响的公开页面，检查标题、日期、关键正文和附件，确认展示的是这次改动。

构建、部署和公开内容分别核对。失败时保留已保存成果，按实际失败阶段继续处理，不用重新生成文章补偿发布失败。写入、推送或部署结果不明确时，先回读目标提交和平台状态，再决定是否重试。被更新提交取代而跳过部署时，核对包含本次改动的后续部署与页面。

## 手动发布

先按 [README](../README.md#本地运行) 准备运行环境与依赖，并完成具备相应权限的 Cloudflare 登录；使用 token 时，在当前进程设置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。在仓库根目录依次执行：

```sh
npm run verify
npm run deploy -- --dry-run
npm run deploy
```

`verify` 检查并生成产物，`deploy` 只上传现有 `dist/`。执行前确认当前源码和产物对应本次已核验、获准发布的版本；两步之间修改源码后必须重新验证。dry-run 只检查本地配置与产物，不能证明账户权限或线上部署成功。完成后同样核对对应部署和公开页面。
