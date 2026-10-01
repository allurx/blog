import { site } from "../site.config.ts";
import type { Article } from "./content.ts";
import { escapeHtml, renderMarkdown, type TocEntry } from "./markdown.ts";

export interface PageAssets {
    script: string;
    styles: string[];
}

function absoluteUrl(path: string): string {
    return new URL(path, site.url).href;
}

function articleDates(article: Article): string {
    return `<time datetime="${article.date}">${article.date}</time>${article.updated ? `<span>修订于 <time datetime="${article.updated}">${article.updated}</time></span>` : ""}`;
}

function tags(article: Article): string {
    if (!article.tags.length) return "";
    return `<ul class="article-tags" aria-label="文章标签">${article.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>`;
}

function page(path: string, title: string, description: string, body: string, assets: PageAssets, active = "", article?: Article): string {
    const fullTitle = title === site.title ? title : `${title} · ${site.title}`;
    const canonical = absoluteUrl(path);
    const navigation = [["/", "文章"], ["/archives/", "归档"], ["/about/", "关于"]]
        .map(([url, label]) => `<a href="${url}"${active === url ? ' aria-current="page"' : ""}>${label}</a>`).join("");
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="author" content="${escapeHtml(site.author)}">
${path === "/404.html" ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="/rss.xml">
<link rel="icon" href="/images/favicon.ico">
<meta property="og:type" content="${article ? "article" : "website"}">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
${article ? `<meta property="article:published_time" content="${article.date}T00:00:00+08:00">` : ""}
${article?.updated ? `<meta property="article:modified_time" content="${article.updated}T00:00:00+08:00">` : ""}
<script>(()=>{try{const theme=localStorage.getItem("blog-theme");if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}})();</script>
${assets.styles.map((style) => `<link rel="stylesheet" href="${escapeHtml(style)}">`).join("\n")}
<script type="module" src="${escapeHtml(assets.script)}"></script>
</head>
<body>
<a class="skip-link" href="#main">跳至正文</a>
<header class="site-header">
  <a class="brand" href="/">${escapeHtml(site.title)}<span class="brand-dot" aria-hidden="true"></span></a>
  <nav class="site-nav" aria-label="主导航">${navigation}</nav>
  <label class="theme-control" hidden><span>主题</span><select id="theme-select"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
</header>
${body}
<p id="copy-status" class="sr-only" role="status" aria-live="polite"></p>
<footer class="site-footer"><span>© ${escapeHtml(site.author)}</span><nav aria-label="站点链接"><a href="https://github.com/allurx/blog">GitHub</a><a href="/rss.xml">RSS</a><a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a></nav></footer>
</body>
</html>`;
}

function articleRows(articles: Article[]): string {
    return articles.map((article) => `<li class="article-row" data-domain="${escapeHtml(article.domain)}">
  <div class="article-meta"><time datetime="${article.date}">${article.date}</time><span>${escapeHtml(article.domain)}</span></div>
  <h2><a href="${escapeHtml(article.url)}">${escapeHtml(article.title)}</a></h2>
  ${article.summary ? `<p class="summary">${escapeHtml(article.summary)}</p>` : ""}
  ${tags(article)}
</li>`).join("\n");
}

function toc(entries: TocEntry[]): string {
    if (!entries.length) return "";
    const minimum = Math.min(...entries.map((entry) => entry.depth));
    return `<nav class="toc" aria-label="文章目录"><details><summary>本文目录</summary><ol>${entries.map((entry) => `<li style="--toc-depth:${entry.depth - minimum}"><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</a></li>`).join("")}</ol></details></nav>`;
}

/**
 * 页面渲染只返回文件内容；开发服务器与生产构建共用同一份 HTML。
 */
export function renderSite(articles: Article[], aboutMarkdown: string, assets: PageAssets): Map<string, string> {
    const documents = new Map<string, string>();
    const domains = [...new Set(articles.map((article) => article.domain))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const filters = `<form class="article-filters" role="search" action="/" method="get" hidden>
  <label class="search-field"><span>搜索文章</span><input id="search" name="q" type="search" placeholder="搜索标题、摘要或标签" autocomplete="off"></label>
  <label class="domain-field"><span>领域</span><select id="domain-filter" name="domain"><option value="">全部领域</option>${domains.map((domain) => `<option value="${escapeHtml(domain)}">${escapeHtml(domain)}</option>`).join("")}</select></label>
</form>`;
    const home = `<main id="main" class="index-page">
  <header class="page-intro"><h1>技术文章</h1><p>${escapeHtml(site.description)}</p></header>
  <section aria-label="文章列表">${filters}<div class="list-status"><p id="article-count" role="status" aria-live="polite">共 ${articles.length} 篇文章</p><button id="clear-filters" type="button" hidden>清除筛选</button></div><ul class="article-list">${articleRows(articles)}</ul><div id="empty-state" class="empty-state" hidden><h2>没有找到匹配的文章</h2><p>换个关键词，或清除筛选后重新查找。</p></div></section>
</main>`;
    documents.set("index.html", page("/", site.title, site.description, home, assets, "/"));

    const years = [...new Set(articles.map((article) => article.date.slice(0, 4)))];
    const archive = `<main id="main" class="index-page"><header class="page-intro"><h1>文章归档</h1><p>按发表时间查阅，共 ${articles.length} 篇文章。</p></header>${years.map((year) => `<section class="archive-year"><h2>${year}</h2><ul>${articles.filter((article) => article.date.startsWith(year)).map((article) => `<li><time datetime="${article.date}">${article.date.slice(5)}</time><a href="${escapeHtml(article.url)}">${escapeHtml(article.title)}</a><span>${escapeHtml(article.domain)}</span></li>`).join("")}</ul></section>`).join("")}</main>`;
    documents.set("archives/index.html", page("/archives/", "文章归档", `按发表日期查阅 ${site.title} 的技术文章。`, archive, assets, "/archives/"));

    const about = `<main id="main" class="text-page"><header class="page-intro"><h1>关于</h1></header><div class="prose">${renderMarkdown(aboutMarkdown).html}</div></main>`;
    documents.set("about/index.html", page("/about/", "关于", `关于 ${site.title} 与技术写作。`, about, assets, "/about/"));
    const notFound = '<main id="main" class="text-page not-found"><p class="eyebrow">404</p><h1>页面未找到</h1><p>这个地址没有对应的文章。可以返回文章列表查找。</p><a class="button-link" href="/">浏览文章</a></main>';
    documents.set("404.html", page("/404.html", "页面未找到", "请求的页面不存在。", notFound, assets));

    for (const article of articles) {
        const rendered = renderMarkdown(article.markdown);
        const body = `<main id="main" class="article-page${rendered.toc.length ? "" : " without-toc"}"><article aria-labelledby="article-title">
  <header class="article-header"><a class="back-link" href="/">← 全部文章</a><p class="eyebrow">${escapeHtml(article.domain)}</p><h1 id="article-title">${escapeHtml(article.title)}</h1><div class="article-meta">${articleDates(article)}</div>${tags(article)}</header>
  <div class="reading-layout">${toc(rendered.toc)}<div class="prose">${rendered.html}</div></div>
  <footer class="article-footer"><p>作者 ${escapeHtml(site.author)} · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a></p><a href="/">返回文章列表</a></footer>
</article></main>`;
        const outputPath = `${decodeURIComponent(article.url.slice(1))}index.html`;
        documents.set(outputPath, page(article.url, article.title, article.summary || article.title, body, assets, "", article));
    }

    // 订阅和搜索引擎使用原发表日期；修订日期只补充修改时间，不重新发布文章。
    documents.set("rss.xml", `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escapeHtml(site.title)}</title><link>${escapeHtml(site.url)}</link><description>${escapeHtml(site.description)}</description><language>zh-CN</language><atom:link href="${escapeHtml(absoluteUrl("/rss.xml"))}" rel="self" type="application/rss+xml"/>${articles.map((article) => `<item><title>${escapeHtml(article.title)}</title><link>${escapeHtml(absoluteUrl(article.url))}</link><guid isPermaLink="true">${escapeHtml(absoluteUrl(article.url))}</guid><pubDate>${new Date(`${article.date}T00:00:00+08:00`).toUTCString()}</pubDate><description>${escapeHtml(article.summary)}</description>${article.tags.map((tag) => `<category>${escapeHtml(tag)}</category>`).join("")}</item>`).join("")}</channel></rss>`);
    documents.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/archives/", "/about/"].map((path) => `<url><loc>${escapeHtml(absoluteUrl(path))}</loc></url>`).join("")}${articles.map((article) => `<url><loc>${escapeHtml(absoluteUrl(article.url))}</loc>${article.updated ? `<lastmod>${article.updated}</lastmod>` : ""}</url>`).join("")}</urlset>`);
    return documents;
}
