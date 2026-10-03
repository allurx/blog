/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

interface HtmlReferences {
    anchors: Set<string>;
    links: { attribute: string; value: string }[];
}

/**
 * 只还原本项目 HTML 属性使用的实体，保留原值中的下一层转义。
 */
function decodeAttribute(value: string): string {
    const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
        if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? entity;
        const codePoint =
            name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            ? String.fromCodePoint(codePoint)
            : "\ufffd";
    });
}

function htmlReferences(html: string): HtmlReferences {
    const anchors = new Set<string>();
    const links: HtmlReferences["links"] = [];

    // 生成器输出带引号的属性；逐个读取属性，避免把 title 或代码文本误作链接。
    for (const tag of html.matchAll(/<([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi)) {
        for (const attribute of (tag[2] ?? "").matchAll(
            /([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g
        )) {
            const name = (attribute[1] ?? "").toLowerCase();
            const value = decodeAttribute(attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
            if (name === "id" || (name === "name" && tag[1]?.toLowerCase() === "a")) anchors.add(value);
            if (name === "href" || name === "src") links.push({ attribute: name, value });
        }
    }

    return { anchors, links };
}

/**
 * 按最终输出检查本地链接。路径区分大小写，避免 Windows 上存在的文件在部署后失效。
 * documents 与 assetPaths 均使用相对于输出目录的正斜杠路径；非 HTML 资源只检查存在性。
 */
export function checkLocalLinks(
    documents: ReadonlyMap<string, string>,
    assetPaths: Iterable<string>,
    siteUrl: string
): void {
    const origin = new URL(siteUrl).origin;
    const errors: string[] = [];
    const paths = new Set<string>();
    const pathsByCase = new Map<string, string>();
    const pages = new Map<string, HtmlReferences>();

    for (const path of [...documents.keys(), ...assetPaths]) {
        const existing = pathsByCase.get(path.toLowerCase());
        if (existing !== undefined) errors.push(`输出路径冲突：${path} 与 ${existing}`);
        paths.add(path);
        pathsByCase.set(path.toLowerCase(), path);
    }
    for (const [path, html] of documents) {
        if (path.endsWith(".html")) pages.set(path, htmlReferences(html));
    }

    for (const [source, { links }] of pages) {
        const sourceUrl = new URL(`/${source.replace(/(^|\/)index\.html$/, "$1")}`, origin);
        for (const { attribute, value } of links) {
            const context = `${source} 的 ${attribute}="${value}"`;
            let target: URL;
            try {
                target = new URL(value, sourceUrl);
            } catch {
                errors.push(`${context}：地址无法解析`);
                continue;
            }
            if (!["http:", "https:"].includes(target.protocol) || target.origin !== origin) continue;

            let pathname: string;
            let fragment: string;
            try {
                pathname = decodeURIComponent(target.pathname).slice(1);
                fragment = decodeURIComponent(target.hash.slice(1));
            } catch {
                errors.push(`${context}：URL 百分号编码无效`);
                continue;
            }

            const candidates =
                pathname.endsWith("/") || !pathname
                    ? [`${pathname}index.html`]
                    : ([pathname, `${pathname}/index.html`] as const);
            const destination = candidates.find((candidate) => paths.has(candidate));
            if (destination === undefined) {
                const caseMatch = candidates
                    .map((candidate) => pathsByCase.get(candidate.toLowerCase()))
                    .find((candidate) => candidate !== undefined);
                errors.push(
                    `${context}：${caseMatch ? `路径大小写不匹配，实际为 ${caseMatch}` : `目标不存在（${candidates[0]}）`}`
                );
                continue;
            }

            const anchors = pages.get(destination)?.anchors;
            if (fragment && fragment.toLowerCase() !== "top" && anchors && !anchors.has(fragment)) {
                errors.push(`${context}：${destination} 中不存在锚点 #${fragment}`);
            }
        }
    }

    if (errors.length)
        throw new Error(`本地链接检查失败（${errors.length} 项）：\n${errors.map((error) => `- ${error}`).join("\n")}`);
}
