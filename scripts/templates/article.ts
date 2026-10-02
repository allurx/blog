/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { site } from "../../site.config.ts";
import type { Article } from "../content/article.ts";
import { icon } from "../icons.ts";
import { escapeHtml } from "../markdown/html.ts";
import { renderMarkdown, type TocEntry } from "../markdown/render.ts";
import { renderPageTools } from "./tools.ts";

function articleDates(article: Article): string {
    const published = `<span>发布于 <time datetime="${article.date}">${article.date}</time></span>`;
    const updated = article.updated && article.updated !== article.date
        ? `<span><span aria-hidden="true">·</span> 更新于 <time datetime="${article.updated}">${article.updated}</time></span>` : "";
    return published + updated;
}

function articleTags(article: Article): string {
    const visibleTags = article.tags.filter((tag) => tag !== article.domain);
    if (!visibleTags.length) return "";
    const tags = visibleTags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("\n");
    return `<ul class="article-tags" aria-label="文章标签">${tags}</ul>`;
}

function articleToc(entries: TocEntry[]): string {
    if (!entries.length) return "";
    interface Section { heading: TocEntry; children: Section[] }
    const sections: Section[] = [];
    const ancestors: Section[] = [];

    // 跳级标题依附最近的较浅标题，没有可用父级时成为顶层入口。
    for (const entry of entries) {
        while (ancestors.length && ancestors.at(-1)!.heading.depth >= entry.depth) ancestors.pop();
        const section: Section = { heading: entry, children: [] };
        (ancestors.at(-1)?.children ?? sections).push(section);
        ancestors.push(section);
    }

    const renderList = (items: Section[]): string => `<ol>${items.map(({ heading, children }) => `<li><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>${children.length
        ? "\n" + renderList(children) : ""}</li>`).join("\n")}</ol>`;

    return `<nav id="article-toc" class="toc" popover="auto" aria-labelledby="toc-title">
  <div class="toc-header">
    <div><h2 id="toc-title">本文目录</h2><p>${entries.length} 个章节</p></div>
    <button class="toc-close" type="button" popovertarget="article-toc" popovertargetaction="hide" aria-label="关闭文章目录" autofocus>${icon("close")}</button>
  </div>
  <div class="toc-list">${renderList(sections)}</div>
</nav>`;
}

/**
 * 文章正文与目录一同生成；图片尺寸使用文章资源清单，避免阅读时加载图片改变布局。
 * 同一目录与竖向工具栏适配可用空间，原生弹出层无脚本时仍可开关。
 */
export function renderArticle(article: Article): string {
    const articleUrl = new URL(article.url, site.url);
    const imageSizes = new Map(article.assets.map((asset) => [new URL("/" + asset.outputPath, site.url).href, asset.imageSize]));
    const rendered = renderMarkdown(article.markdown, (href) => imageSizes.get(new URL(href, articleUrl).href),
        ["main", "theme-select", "copy-status", "article-title", "article-end", "article-toc", "toc-title", "page-top", "page-end"]);

    return `<main id="main" class="article-page page-with-tools${rendered.toc.length ? "" : " without-toc"}">
  <aside class="article-navigation" aria-label="阅读导航">
    ${articleToc(rendered.toc)}
  </aside>
  <article class="page-panel" aria-labelledby="article-title">
    <header class="article-header" id="page-top">
      <h1 id="article-title">${escapeHtml(article.title)}</h1>
      <div class="article-meta"><span class="article-domain">${escapeHtml(article.domain)}</span>${articleDates(article)}</div>
      ${articleTags(article)}
    </header>
    <div class="prose">${rendered.html}</div>
    <div class="page-end" id="page-end"><span id="article-end"></span></div>
  </article>
  ${renderPageTools("article", rendered.toc.length > 0)}
</main>`;
}
