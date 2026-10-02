/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Article } from "../content/article.ts";
import { domainGroups } from "../content/domains.ts";
import { icon } from "../icons.ts";
import { escapeHtml } from "../markdown/html.ts";
import { renderPageTools } from "./tools.ts";

function articleRows(articles: Article[]): string {
    return articles.map((article) => {
        const tags = article.tags.filter((tag) => tag !== article.domain);
        const badges = tags.slice(0, 2).map((tag) => `<span class="article-tag">${escapeHtml(tag)}</span>`).join(" ");
        const remaining = tags.slice(2);
        const extra = remaining.length ? `<span class="article-tag article-tag-more" title="${escapeHtml(remaining.join("、"))}"><span aria-hidden="true">+${remaining.length}</span><span class="sr-only">其余标签：${escapeHtml(remaining.join("、"))}</span></span>` : "";

        return `<li class="article-row"
    data-domain="${escapeHtml(article.domain)}"
    data-search="${escapeHtml([article.title, article.summary, article.domain, article.date, ...article.tags].join(" "))}">
  <a class="article-link" href="${escapeHtml(article.url)}" aria-labelledby="title-${escapeHtml(article.id)}"${tags.length ? ` aria-describedby="tags-${escapeHtml(article.id)}"` : ""}>
    <div class="article-title-line">
      <h2 id="title-${escapeHtml(article.id)}">${escapeHtml(article.title)}</h2>
      ${tags.length ? `<span class="article-row-tags" id="tags-${escapeHtml(article.id)}">${badges}${extra ? " " + extra : ""}</span>` : ""}
    </div>
    <time datetime="${article.date}">${article.date.replaceAll("-", ".")}</time>
    ${icon("arrow-right")}
  </a>
</li>`;
    }).join("\n");
}

function articleDomainOptions(articles: Article[]): string {
    const counts = new Map<string, number>();
    for (const article of articles) counts.set(article.domain, (counts.get(article.domain) ?? 0) + 1);

    // 领域导航展示完整知识范围；未收录的新方向仍可通过实际文章进入筛选。
    const known = new Set(domainGroups.flatMap((group) => group.domains));
    const additional = [...counts.keys()].filter((domain) => !known.has(domain)).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const groups = additional.length ? [...domainGroups, { title: "其他领域", domains: additional }] : domainGroups;
    return groups.map((group) => {
        const total = group.domains.reduce((sum, domain) => sum + (counts.get(domain) ?? 0), 0);
        const options = group.domains.map((domain) => {
            const count = counts.get(domain) ?? 0;
            return `<label class="domain-option"><input class="sr-only" type="checkbox" name="domain" value="${escapeHtml(domain)}"${count ? "" : " disabled"}><span class="domain-option-name">${escapeHtml(domain)}</span><span class="domain-option-count">${count}<span class="sr-only"> 篇文章</span></span>${icon("check")}</label>`;
        }).join("\n");
        return `<details class="domain-group">
  <summary><span>${escapeHtml(group.title)}</span><span class="domain-group-count">${total} 篇</span>${icon("chevron-down")}</summary>
  <fieldset class="domain-choices"><legend class="sr-only">${escapeHtml(group.title)}</legend>${options}</fieldset>
</details>`;
    }).join("\n");
}

/**
 * 首页直接提供完整文章列表；筛选与结果状态由浏览器渐进增强。
 */
export function renderHome(articles: Article[]): string {
    return `<main id="main" class="index-page home-page page-with-tools page-panel">
  <section aria-label="文章列表">
    <header class="collection-heading" id="page-top">
      <h1>文章</h1>
      <p id="article-count" class="collection-count" role="status" aria-live="polite" aria-atomic="true">${articles.length} 篇</p>
    </header>
    <div class="collection-toolbar" data-pending>
      <form class="article-filters" role="search" action="/" method="get">
        <div class="search-field">
          <label class="sr-only" for="search">搜索文章</label>
          ${icon("search")}
          <input id="search" name="q" type="search" placeholder="搜索文章" title="搜索标题、摘要或标签" autocomplete="off">
          <button id="clear-filters" type="button" hidden aria-label="清除筛选" title="清除筛选">${icon("close")}</button>
        </div>
        <details class="domain-field" id="domain-filter">
          <summary>${icon("filter")}<span id="domain-selection">全部领域</span>${icon("chevron-down")}</summary>
          <fieldset class="domain-options">
            <legend class="sr-only">文章领域，可多选</legend>
            <p class="domain-hint">可多选；数字为已发布文章数，0 篇的领域暂不可选。</p>
            ${articleDomainOptions(articles)}
            <div class="domain-actions"><button id="clear-domains" type="button" disabled>${icon("close")}<span>清除选择</span></button></div>
          </fieldset>
        </details>
      </form>
    </div>
    <ul class="article-list">${articleRows(articles)}</ul>
    <div id="empty-state" class="empty-state" hidden>
      ${icon("search")}
      <h2>没有找到匹配的文章</h2>
      <p>换个关键词，或重置筛选后重新查找。</p>
    </div>
  </section>
  <div class="page-end" id="page-end"></div>
  ${renderPageTools("home")}
</main>`;
}

export function renderArchive(articles: Article[]): string {
    const years = [...new Set(articles.map((article) => article.date.slice(0, 4)))];
    const yearLinks = years.map((year) => `<a href="#year-${year}">${year}</a>`).join("\n");
    const sections = years.map((year) => {
        const entries = articles.filter((article) => article.date.startsWith(year));
        const rows = entries.map((article) => `<li>
  <time datetime="${article.date}">${article.date.slice(5).replace("-", ".")}</time>
  <a href="${escapeHtml(article.url)}">${escapeHtml(article.title)}</a>
  <span>${escapeHtml(article.domain)}</span>
</li>`).join("\n");

        return `<section class="archive-year" id="year-${year}">
  <h2>${year}<span>${entries.length} 篇</span></h2>
  <ul>${rows}</ul>
</section>`;
    }).join("\n");

    return `<main id="main" class="index-page page-with-tools page-panel">
  <header class="collection-heading" id="page-top">
    <h1>文章归档</h1>
    <p class="collection-count">${articles.length} 篇</p>
  </header>
  <nav class="archive-index" aria-label="按年份浏览">${yearLinks}</nav>
  ${sections}
  <div class="page-end" id="page-end"></div>
  ${renderPageTools("archive")}
</main>`;
}

export function renderNotFound(): string {
    return `<main id="main" class="text-page not-found">
  <p class="eyebrow">404</p>
  <h1>页面未找到</h1>
  <p>这个地址没有对应的文章。可以返回文章列表查找。</p>
  <a class="button-link" href="/">${icon("arrow-left")}<span>浏览文章</span></a>
</main>`;
}
