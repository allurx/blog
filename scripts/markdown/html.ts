/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

export function escapeHtml(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * 正文允许相对地址、原生锚点与 Web 链接；可执行协议不进入页面。
 */
export function safeUrl(value: string): string {
    const url = value.trim();
    // URL 校验明确拒绝控制字符，正则中的控制字符范围是有意的。
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0020\u007f]/.test(url)) throw new Error(`链接包含控制字符或空白: ${url}`);
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
    if (scheme && !["http", "https", "mailto"].includes(scheme)) throw new Error(`不支持的链接协议 ${scheme}`);
    return url;
}

/**
 * 保留文章中的展示标签和显式锚点，去掉事件、脚本及可执行嵌入。
 */
export function safeRawHtml(html: string): string {
    const allowedTags = new Set([
        "a",
        "img",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "th",
        "td",
        "caption",
        "colgroup",
        "col",
        "br",
        "hr",
        "p",
        "div",
        "span",
        "strong",
        "em",
        "b",
        "i",
        "sup",
        "sub",
        "del",
        "details",
        "summary",
    ]);
    const allowedAttributes = new Set([
        "href",
        "src",
        "alt",
        "title",
        "name",
        "id",
        "colspan",
        "rowspan",
        "scope",
        "width",
        "height",
        "open",
    ]);
    return html
        .replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<\/?([a-z][\w-]*)\b([^>]*)>/gi, (tag: string, name: string, attributes: string) => {
            const normalizedName = name.toLowerCase();
            if (!allowedTags.has(normalizedName)) return escapeHtml(tag);
            if (tag.startsWith("</")) return `</${normalizedName}>`;
            const kept: string[] = [];
            for (const attribute of attributes.matchAll(
                /([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g
            )) {
                const key = (attribute[1] ?? "").toLowerCase();
                if (!allowedAttributes.has(key)) continue;
                const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
                if (key === "href" || key === "src") safeUrl(value);
                kept.push(`${key}="${escapeHtml(value)}"`);
            }
            return `<${normalizedName}${kept.length ? ` ${kept.join(" ")}` : ""}>`;
        });
}
