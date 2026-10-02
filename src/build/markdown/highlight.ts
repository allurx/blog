import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// 只加载文章使用的语法；高亮在构建时完成，浏览器只接收静态标记。
for (const [name, language] of Object.entries({ bash, c, java, javascript, json, markdown, sql, typescript, xml, yaml })) {
    hljs.registerLanguage(name, language);
}
hljs.registerAliases("mysql", { languageName: "sql" });

/**
 * 按围栏中的语言生成已转义的 HTML；未声明或未支持的语言交由正文渲染器转义。
 * 不猜测语言，避免将日志、输出结果和普通文本误当作代码。
 */
export function highlightCode(text: string, language: string): string | undefined {
    if (!language || !hljs.getLanguage(language)) return undefined;
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}
