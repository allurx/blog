import { renderToString } from "katex";
import { Marked, Renderer, type Token } from "marked";

export interface TocEntry {
    id: string;
    title: string;
    depth: number;
}

export function escapeHtml(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * 正文允许相对地址、原生锚点与 Web 链接；可执行协议不进入页面。
 */
function safeUrl(value: string): string {
    const url = value.trim();
    if (/[\u0000-\u0020\u007f]/.test(url)) throw new Error(`链接包含控制字符或空白: ${url}`);
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
    if (scheme && !["http", "https", "mailto"].includes(scheme)) throw new Error(`不支持的链接协议 ${scheme}`);
    return url;
}

/**
 * 保留文章中的展示标签和旧锚点，去掉事件、脚本及可执行嵌入。
 */
function safeRawHtml(html: string): string {
    const allowedTags = new Set(["a", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col", "br", "hr", "p", "div", "span", "strong", "em", "b", "i", "sup", "sub", "del", "details", "summary"]);
    const allowedAttributes = new Set(["href", "src", "alt", "title", "name", "id", "colspan", "rowspan", "scope", "width", "height", "open"]);
    return html.replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?([a-z][\w-]*)\b([^>]*)>/gi, (tag: string, name: string, attributes: string) => {
        const normalizedName = name.toLowerCase();
        if (!allowedTags.has(normalizedName)) return escapeHtml(tag);
        if (tag.startsWith("</")) return `</${normalizedName}>`;
        const kept: string[] = [];
        for (const attribute of attributes.matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g)) {
            const key = (attribute[1] ?? "").toLowerCase();
            if (!allowedAttributes.has(key)) continue;
            const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
            if (key === "href" || key === "src") safeUrl(value);
            kept.push(`${key}="${escapeHtml(value)}"`);
        }
        return `<${normalizedName}${kept.length ? ` ${kept.join(" ")}` : ""}>`;
    });
}

function tokenText(token: Token): string {
    if (token.type === "code") return "";

    // 泛型中的未知标签（例如 Callable<V>）会作为文字显示，摘要也保留它。
    if (token.type === "html") return safeRawHtml(token.text) === escapeHtml(token.text) ? token.text : "";
    if (token.type === "list") return `${token.items.map(tokenText).join(" ")} `;
    if ("tokens" in token && token.tokens) {
        const text = token.tokens.map(tokenText).join("");
        return ["blockquote", "paragraph", "list_item"].includes(token.type) ? `${text} ` : text;
    }

    switch (token.type) {
        case "text":
        case "codespan":
        case "escape":
            return token.text;
        case "br":
        case "space":
            return " ";
        default:
            return "";
    }
}

function plainText(tokens: Token[]): string {
    return tokens.map(tokenText).join("").replace(/\s+/g, " ").trim();
}

/**
 * 摘要来自开篇段落或列表，按 Unicode 字符截取，不拆开代理对。
 */
export function summarizeMarkdown(markdown: string): string {
    const opening = new Marked().lexer(markdown).find((token) => ["paragraph", "list", "blockquote"].includes(token.type));
    const characters = [...(opening ? plainText([opening]) : "")];
    return characters.length > 160 ? `${characters.slice(0, 160).join("")}…` : characters.join("");
}

const tableContainer = '<div class="table-scroll" tabindex="0" role="region" aria-label="表格">';

/**
 * Markdown 是正文唯一来源。生成锚点、目录、MathML 和渐进增强所需的静态结构。
 */
export function renderMarkdown(markdown: string): { html: string; toc: TocEntry[] } {
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
                return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language || "代码")}</span><button class="code-copy" type="button" hidden aria-label="复制代码">复制</button></div><pre tabindex="0" aria-label="代码"><code${className}>${escapeHtml(text)}\n</code></pre><p class="code-feedback" hidden></p></div>\n`;
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
                return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy" decoding="async">`;
            },
        },
    });
    return { html: parser.parse(markdown) as string, toc };
}
