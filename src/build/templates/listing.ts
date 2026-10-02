import type { Article } from "../content/article.ts";
import { icon } from "../icons.ts";
import { escapeHtml } from "../markdown/html.ts";

function articleRows(articles: Article[]): string {
    return articles.map((article) => `<li class="article-row"
    data-domain="${escapeHtml(article.domain)}"
    data-search="${escapeHtml([article.title, article.summary, article.domain, article.date, ...article.tags].join(" "))}">
  <a class="article-link" href="${escapeHtml(article.url)}" aria-labelledby="title-${escapeHtml(article.id)}">
    <h2 id="title-${escapeHtml(article.id)}">${escapeHtml(article.title)}</h2>
    <time datetime="${article.date}">${article.date.replaceAll("-", ".")}</time>
    ${icon("arrow-right")}
  </a>
</li>`).join("\n");
}

/**
 * 首页直接提供完整文章列表；筛选与结果状态由浏览器渐进增强。
 */
export function renderHome(articles: Article[]): string {
    const domains = [...new Set(articles.map((article) => article.domain))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const domainOptions = domains.map((domain) => `<option value="${escapeHtml(domain)}">${escapeHtml(domain)}</option>`).join("\n");

    return `<main id="main" class="index-page home-page">
  <section aria-label="文章列表">
    <header class="collection-heading">
      <h1>文章</h1>
      <p id="article-count" role="status" aria-live="polite" aria-atomic="true">${articles.length} 篇</p>
    </header>
    <div class="collection-toolbar" hidden>
      <form class="article-filters" role="search" action="/" method="get" hidden>
        <div class="search-field">
          <label class="sr-only" for="search">搜索文章</label>
          ${icon("search")}
          <input id="search" name="q" type="search" placeholder="搜索文章" title="搜索标题、摘要或标签" autocomplete="off">
          <button id="clear-filters" type="button" hidden aria-label="清除筛选" title="清除筛选">${icon("close")}</button>
        </div>
        <label class="domain-field">
          <span class="sr-only">文章领域</span>
          ${icon("filter")}
          <select id="domain-filter" name="domain">
            <option value="">全部领域</option>
            ${domainOptions}
          </select>
          ${icon("chevron-down")}
        </label>
      </form>
    </div>
    <ul class="article-list">${articleRows(articles)}</ul>
    <div id="empty-state" class="empty-state" hidden>
      ${icon("search")}
      <h2>没有找到匹配的文章</h2>
      <p>换个关键词，或重置筛选后重新查找。</p>
    </div>
  </section>
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

    return `<main id="main" class="index-page">
  <header class="page-intro">
    <div>
      <p class="eyebrow">按时间回看</p>
      <h1>文章归档</h1>
    </div>
    <p>共 ${articles.length} 篇文章，记录一路走来的问题与思考。</p>
  </header>
  <nav class="archive-index" aria-label="按年份浏览">${yearLinks}</nav>
  ${sections}
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
