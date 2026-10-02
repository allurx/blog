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

const tableContainer = '<div class="table-scroll" tabindex="0" role="region" aria-label="表格">';

/**
 * Markdown 是正文唯一来源。生成锚点、目录、MathML 和渐进增强所需的静态结构。
 */
export function renderMarkdown(markdown: string, imageSize?: (url: string) => { width: number; height: number } | undefined): { html: string; toc: TocEntry[] } {
    const toc: TocEntry[] = [];
    const ids = new Set<string>();
    const parser = new Marked({ async: false, gfm: true });
    parser.use({
        extensions: [{
            name: "displayMath",
            level: "block",
            start(source) { return /^\$\$[ \t]*$/m.exec(source)?.index; },
            tokenizer(source) {
                const match = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(source);
                if (!match) return undefined;
                return { type: "displayMath", raw: match[0], text: match[1] ?? "" };
            },
            renderer(token) {
                const math = renderToString(String(token["text"]), { displayMode: true, output: "mathml", throwOnError: true, trust: false });
                return `<div class="math-block">${math}</div>\n`;
            },
        }],
        renderer: {
            heading({ tokens, depth }) {
                const html = this.parser.parseInline(tokens);
                const title = plainText(tokens);
                const slug = title.toLocaleLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "") || "section";
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
                return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language || "代码")}</span><button class="code-copy" type="button" hidden aria-label="复制代码">${icon("copy")}${icon("check")}<span class="copy-label">复制</span></button></div><pre tabindex="0" aria-label="代码"><code${className}>${code}\n</code></pre><p class="code-feedback" hidden></p></div>\n`;
            },
            table(token) {
                return `${tableContainer}${Renderer.prototype.table.call(this, token)}</div>\n`;
            },
            html({ text }) {
                return safeRawHtml(text).replace(/<table(?=[\s>])/g, `${tableContainer}<table`).replace(/<\/table>/g, "</table></div>");
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
