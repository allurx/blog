/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderToString } from "katex";
import { Marked, Renderer } from "marked";
import { icon } from "../icons.ts";
import { highlightCode } from "./highlight.ts";
import { escapeHtml, safeRawHtml, safeUrl } from "./html.ts";
import { plainText } from "./text.ts";

export interface TocEntry {
    id: string;
    title: string;
    depth: number;
}

const defaultRenderer = new Renderer();
const tableContainer = '<div class="table-scroll" tabindex="0" role="region" aria-label="表格">';
// 紧邻分隔符的内容不能是空白，结束符后不能接数字，以免把两笔美元金额识别为公式。
const inlineMath = /(?<![\\$])\$(?![\s$])((?:\\[^\n]|[^\\$\n])+?)(?<!\s)\$(?![\d$])/;

/**
 * Markdown 是正文唯一来源。生成锚点、目录、MathML 和渐进增强所需的静态结构。
 * reservedIds 是调用者已占用的页面 ID，生成标题锚点时一并避让。
 */
export function renderMarkdown(
    markdown: string,
    imageSize?: (url: string) => { width: number; height: number } | undefined,
    reservedIds: Iterable<string> = []
): { html: string; toc: TocEntry[] } {
    const toc: TocEntry[] = [];
    const ids = new Set(reservedIds);
    const parser = new Marked({ async: false, gfm: true });
    parser.use({
        hooks: {
            emStrongMask(source) {
                // TeX 的下标与乘号不能提前参与 Markdown 的斜体、粗体配对。
                return source.replace(
                    new RegExp(inlineMath.source, "g"),
                    (match) => `[${"a".repeat(match.length - 2)}]`
                );
            },
        },
        extensions: [
            {
                name: "inlineMath",
                level: "inline",
                start(source) {
                    return source.indexOf("$");
                },
                tokenizer(source, tokens) {
                    if (this.lexer.state.inRawBlock || tokens.at(-1)?.raw.endsWith("$")) return undefined;
                    const match = inlineMath.exec(source);
                    if (match?.index !== 0) return undefined;
                    return { type: "inlineMath", raw: match[0], text: match[1] ?? "" };
                },
                renderer(token) {
                    return renderToString(String(token["text"]), {
                        displayMode: false,
                        output: "mathml",
                        throwOnError: true,
                        trust: false,
                    });
                },
            },
            {
                name: "displayMath",
                level: "block",
                start(source) {
                    return /^\$\$[ \t]*$/m.exec(source)?.index;
                },
                tokenizer(source) {
                    const match = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(source);
                    if (!match) return undefined;
                    return { type: "displayMath", raw: match[0], text: match[1] ?? "" };
                },
                renderer(token) {
                    const math = renderToString(String(token["text"]), {
                        displayMode: true,
                        output: "mathml",
                        throwOnError: true,
                        trust: false,
                    });
                    return `<div class="math-block">${math}</div>\n`;
                },
            },
        ],
        renderer: {
            heading({ tokens, depth }) {
                const html = this.parser.parseInline(tokens);
                const title = plainText(tokens);
                const slug =
                    title
                        .toLocaleLowerCase()
                        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
                        .replace(/^-|-$/g, "") || "section";
                let id = slug;
                for (let duplicate = 2; ids.has(id); duplicate++) id = `${slug}-${duplicate}`;
                ids.add(id);
                toc.push({ id, title, depth });
                return `<h${depth} id="${escapeHtml(id)}">${html}</h${depth}>\n`;
            },
            code({ text, lang }) {
                const language = lang?.split(/\s/)[0] ?? "";
                const className = language ? ` class="language-${escapeHtml(language)}"` : "";
                const code = highlightCode(text, language) ?? escapeHtml(text);
                return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language || "代码")}</span><button class="code-copy" type="button" data-pending aria-label="复制代码">${icon("copy")}${icon("check")}<span class="copy-label">复制</span></button></div><pre tabindex="0" aria-label="代码"><code${className}>${code}\n</code></pre><p class="code-feedback" hidden></p></div>\n`;
            },
            table(token) {
                const table: string = defaultRenderer.table.call(this, token);
                return `${tableContainer}${table}</div>\n`;
            },
            html({ text }) {
                return safeRawHtml(text)
                    .replace(/<table(?=[\s>])/g, `${tableContainer}<table`)
                    .replace(/<\/table>/g, "</table></div>");
            },
            link({ href, title, tokens }) {
                return `<a href="${escapeHtml(safeUrl(href))}"${title ? ` title="${escapeHtml(title)}"` : ""}>${this.parser.parseInline(tokens)}</a>`;
            },
            image({ href, title, text }) {
                const size = imageSize?.(href);
                const dimensions = size ? ` width="${size.width}" height="${size.height}"` : "";
                return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""}${dimensions} loading="lazy" decoding="async">`;
            },
        },
    });
    return { html: parser.parse(markdown) as string, toc };
}
