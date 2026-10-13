/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { Marked } from "marked";
import type { MarkedToken, Token } from "marked";
import { escapeHtml, safeRawHtml } from "./html.ts";

function tokenText(input: Token): string {
    // 目录保留标题中的公式文本，避免行内公式扩展使标题与锚点缺字。
    if (input.type === "inlineMath" && "text" in input) return String(input["text"]);

    const token = input as MarkedToken;
    if (token.type === "code") return "";

    // 泛型中的未知标签（例如 Callable<V>）会作为文字显示，摘要也保留它。
    if (token.type === "html") return safeRawHtml(token.text) === escapeHtml(token.text) ? token.text : "";
    if (token.type === "list") return `${token.items.map(tokenText).join(" ")} `;
    if ("tokens" in token) {
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
 * 摘要来自开篇段落或列表，按 Unicode 码点截取，不拆开代理对。
 */
export function summarizeMarkdown(markdown: string): string {
    const opening = new Marked()
        .lexer(markdown)
        .find((token) => ["paragraph", "list", "blockquote"].includes(token.type));
    const text = opening ? plainText([opening]) : "";
    const characters = Array.from(text);
    return characters.length > 160 ? `${characters.slice(0, 160).join("")}…` : characters.join("");
}
