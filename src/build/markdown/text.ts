import { Marked, type Token } from "marked";
import { escapeHtml, safeRawHtml } from "./html.ts";

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

export function plainText(tokens: Token[]): string {
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

