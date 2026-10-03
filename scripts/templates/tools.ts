/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { icon } from "../icons.ts";

/**
 * 列表、归档和文章共用同一竖向工具栏，页面仅决定返回入口及是否提供目录。
 */
export function renderPageTools(page: "home" | "archive" | "article", hasToc = false): string {
    const destination =
        page === "home"
            ? `<a href="/archives/" aria-label="文章归档" title="文章归档">${icon("archive")}<span>归档</span></a>`
            : `<a href="/" aria-label="返回文章列表" title="返回文章列表">${icon("arrow-left")}<span>列表</span></a>`;
    return `<details class="page-tools">
  <summary class="page-tools-toggle" title="页面工具">${icon("more-horizontal")}${icon("close")}<span class="sr-only tools-expand-label">展开工具</span><span class="sr-only tools-collapse-label">收起工具</span></summary>
  <nav class="page-tools-actions" aria-label="页面工具">
  <div class="page-tool-group" role="group" aria-label="页面导航">
    ${hasToc ? `<button class="toc-toggle" type="button" popovertarget="article-toc" aria-label="打开或关闭文章目录" title="文章目录">${icon("table-of-contents")}<span>目录</span></button>` : ""}
    ${destination}
  </div>
  <div class="page-tool-group" role="group" aria-label="页面滚动">
    <a href="#page-top" aria-label="回到页面顶部" title="回到页面顶部">${icon("arrow-up")}<span>顶部</span></a>
    <a href="#page-end" aria-label="前往页面底部" title="前往页面底部">${icon("arrow-down")}<span>底部</span></a>
  </div>
  </nav>
</details>
<script>document.currentScript.previousElementSibling.open=matchMedia("(width >= 40rem)").matches;</script>`;
}
