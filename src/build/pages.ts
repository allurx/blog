import { site } from "../../site.config.ts";
import type { Article } from "./content/article.ts";
import { escapeHtml } from "./markdown/html.ts";
import { renderArticle } from "./templates/article.ts";
import { renderArchive, renderHome, renderNotFound } from "./templates/listing.ts";
import { renderPage, type PageAssets } from "./templates/shell.ts";

function absoluteUrl(path: string): string {
    return new URL(path, site.url).href;
}

/**
 * 页面渲染只返回文件内容；开发服务器与生产构建共用路由、页面与订阅文档。
 */
export function renderSite(articles: Article[], assets: PageAssets): Map<string, string> {
    const documents = new Map<string, string>();
    documents.set("index.html", renderPage({
        path: "/",
        title: site.title,
        description: site.description,
        body: renderHome(articles),
        assets,
        active: "/",
    }));
    documents.set("archives/index.html", renderPage({
        path: "/archives/",
        title: "文章归档",
        description: `按发表日期查阅 ${site.title} 的技术文章。`,
        body: renderArchive(articles),
        assets,
        active: "/archives/",
    }));
    documents.set("404.html", renderPage({
        path: "/404.html",
        title: "页面未找到",
        description: "请求的页面不存在。",
        body: renderNotFound(),
        assets,
    }));

    for (const article of articles) {
        const outputPath = `${decodeURIComponent(article.url.slice(1))}index.html`;
        documents.set(outputPath, renderPage({
            path: article.url,
            title: article.title,
            description: article.summary || article.title,
            body: renderArticle(article),
            assets,
            article,
        }));
    }

    // 订阅和搜索引擎使用原发表日期；修订日期只补充修改时间，不重新发布文章。
    const rssItems = articles.map((article) => `<item>
  <title>${escapeHtml(article.title)}</title>
  <link>${escapeHtml(absoluteUrl(article.url))}</link>
  <guid isPermaLink="true">${escapeHtml(absoluteUrl(article.url))}</guid>
  <pubDate>${new Date(`${article.date}T00:00:00+08:00`).toUTCString()}</pubDate>
  <description>${escapeHtml(article.summary)}</description>
  ${article.tags.map((tag) => `<category>${escapeHtml(tag)}</category>`).join("\n  ")}
</item>`).join("\n");
    documents.set("rss.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(site.title)}</title>
    <link>${escapeHtml(site.url)}</link>
    <description>${escapeHtml(site.description)}</description>
    <language>zh-CN</language>
    <atom:link href="${escapeHtml(absoluteUrl("/rss.xml"))}" rel="self" type="application/rss+xml"/>
    ${rssItems}
  </channel>
</rss>`);

    const indexUrls = ["/", "/archives/"].map((path) => `<url><loc>${escapeHtml(absoluteUrl(path))}</loc></url>`).join("\n");
    const articleUrls = articles.map((article) => `<url>
  <loc>${escapeHtml(absoluteUrl(article.url))}</loc>
  ${article.updated ? `<lastmod>${article.updated}</lastmod>` : ""}
</url>`).join("\n");
    documents.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${indexUrls}
  ${articleUrls}
</urlset>`);
    return documents;
}
