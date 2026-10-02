import { site } from "../../../site.config.ts";
import type { Article } from "../content/article.ts";
import { icon } from "../icons.ts";
import { escapeHtml } from "../markdown/html.ts";
import { renderMarkdown, type TocEntry } from "../markdown/render.ts";

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
    const minimum = Math.min(...entries.map((entry) => entry.depth));
    const links = entries.map((entry) => `<li style="--toc-depth:${entry.depth - minimum}">
  <a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</a>
</li>`).join("\n");

    return `<nav class="toc" aria-label="文章目录">
  <details open>
    <summary><span>本文目录</span>${icon("chevron-down")}</summary>
    <ol>${links}</ol>
  </details>
</nav>`;
}

/**
 * 文章正文与目录一同生成；图片尺寸使用文章资源清单，避免阅读时加载图片改变布局。
 */
export function renderArticle(article: Article): string {
    const articleUrl = new URL(article.url, site.url);
    const imageSizes = new Map(article.assets.map((asset) => [new URL("/" + asset.outputPath, site.url).href, asset.imageSize]));
    const rendered = renderMarkdown(article.markdown, (href) => imageSizes.get(new URL(href, articleUrl).href));

    return `<main id="main" class="article-page${rendered.toc.length ? "" : " without-toc"}">
  <article aria-labelledby="article-title">
    <header class="article-header">
      <a class="back-link" href="/">${icon("arrow-left")}<span>全部文章</span></a>
      <p class="eyebrow">${escapeHtml(article.domain)}</p>
      <h1 id="article-title">${escapeHtml(article.title)}</h1>
      <div class="article-meta">${articleDates(article)}</div>
      ${articleTags(article)}
    </header>
    <div class="reading-layout">
      ${articleToc(rendered.toc)}
      <div class="prose">${rendered.html}</div>
    </div>
    <footer class="article-footer">
      <div class="article-footer-nav">
        <a href="/">${icon("arrow-left")}<span>返回文章列表</span></a>
        <a href="#article-title"><span>回到开头</span>${icon("arrow-up")}</a>
      </div>
    </footer>
  </article>
</main>`;
}
