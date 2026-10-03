/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { site } from "../../site.config.ts";
import type { Article } from "../content/article.ts";
import { icon } from "../icons.ts";
import { escapeHtml } from "../markdown/html.ts";

export interface PageAssets {
    script: string;
    styles: string[];
    initialStyles: string;
}

export interface PageOptions {
    path: string;
    title: string;
    description: string;
    body: string;
    assets: PageAssets;
    active?: string;
    article?: Article;
}

/**
 * 所有页面共用元信息、导航、主题选择器与页脚，正文由各页面模板提供。
 */
export function renderPage({ path, title, description, body, assets, active, article }: PageOptions): string {
    const fullTitle = path === "/" ? `${site.author} 的个人博客` : `${title} · ${site.title}`;
    const canonical = new URL(path, site.url).href;
    const websiteId = new URL("/#website", site.url).href;
    const author = { "@type": "Person", name: site.author };
    const structuredData = article
        ? {
              "@context": "https://schema.org",
              "@type": "BlogPosting",
              headline: article.title,
              description,
              url: canonical,
              mainEntityOfPage: canonical,
              inLanguage: "zh-CN",
              author,
              datePublished: `${article.date}T00:00:00+08:00`,
              dateModified: `${article.updated ?? article.date}T00:00:00+08:00`,
              articleSection: article.domain,
              keywords: article.tags,
              isPartOf: { "@id": websiteId },
          }
        : path === "/"
          ? {
                "@context": "https://schema.org",
                "@type": "WebSite",
                "@id": websiteId,
                name: site.title,
                alternateName: `${site.author} 的个人博客`,
                description: site.description,
                url: canonical,
                inLanguage: "zh-CN",
                author,
            }
          : undefined;
    const navigation = (
        [
            ["/", "文章"],
            ["/archives/", "归档"],
        ] as const
    )
        .map(
            ([url, label]) => `<a href="${url}"${active === url ? ' aria-current="page"' : ""}>
    ${icon(url === "/" ? "file" : "archive")}<span>${label}</span>
  </a>`
        )
        .join("\n");

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <script>(()=>{try{const theme=localStorage.getItem("blog-theme");if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}})();</script>
  <style>${assets.initialStyles}</style>
  <noscript><style>[data-pending]{display:none!important}</style></noscript>
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="${escapeHtml(site.author)}">
  ${path === "/404.html" ? '<meta name="robots" content="noindex">' : ""}
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="/rss.xml">
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta property="og:type" content="${article ? "article" : "website"}">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:site_name" content="${escapeHtml(site.title)}">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(fullTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${article ? `<meta property="article:published_time" content="${article.date}T00:00:00+08:00">` : ""}
  ${article?.updated ? `<meta property="article:modified_time" content="${article.updated}T00:00:00+08:00">` : ""}
  ${structuredData ? `<script type="application/ld+json">${JSON.stringify(structuredData).replaceAll("<", "\\u003c")}</script>` : ""}
  ${assets.styles.map((style) => `<link rel="stylesheet" href="${escapeHtml(style)}">`).join("\n  ")}
  <script type="module" src="${escapeHtml(assets.script)}"></script>
</head>
<body>
  <a class="skip-link" href="${article ? "#article-title" : "#main"}">跳至正文</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="${escapeHtml(site.title)}，${escapeHtml(site.author)} 的个人博客首页">${escapeHtml(site.title)}</a>
    <nav class="site-nav" aria-label="主导航">${navigation}</nav>
    <label class="theme-control" data-theme="system" data-pending>
      <span class="sr-only">主题</span>
      ${icon("monitor")}${icon("sun")}${icon("moon")}
      <select id="theme-select" title="主题：跟随系统">
        <button type="button">
          ${icon("monitor")}${icon("sun")}${icon("moon")}
          <selectedcontent></selectedcontent>
          ${icon("chevron-down")}
        </button>
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
      ${icon("chevron-down")}
    </label>
  </header>
  ${body}
  <p id="copy-status" class="sr-only" role="status" aria-live="polite"></p>
  <footer class="site-footer">
    <p class="site-credits">© ${escapeHtml(site.author)} <span aria-hidden="true">·</span> <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">文章 CC BY-NC-SA 4.0</a> <span aria-hidden="true">·</span> <a href="/LICENSE.txt">源码 Apache-2.0</a></p>
    <nav aria-label="站点链接">
      <a href="https://github.com/allurx/blog">${icon("github")}<span>GitHub</span></a>
      <a href="/rss.xml">${icon("rss")}<span>RSS</span></a>
    </nav>
  </footer>
</body>
</html>`;
}
