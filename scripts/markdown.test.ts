import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown, summarizeMarkdown } from "./markdown.ts";

test("目录与标题共享锚点，保留层级、行内 API 和正文旧锚点", () => {
    const rendered = renderMarkdown('## **API** `List<String>`；Callable<V>\n\n### 参考\n\n<a name="旧锚点"></a><a href="#旧锚点">链接</a>\n\n```md\n# 代码中的标题\n```');
    assert.deepEqual(rendered.toc, [
        { id: "api-list-string-callable-v", title: "API List<String>；Callable<V>", depth: 2 },
        { id: "参考", title: "参考", depth: 3 },
    ]);
    assert.match(rendered.html, /<h3 id="参考">参考<\/h3>/);
    assert.match(rendered.html, /name="旧锚点"/);
    assert.match(rendered.html, /href="#旧锚点"/);
    assert.match(rendered.html, /# 代码中的标题/);
});

test("重复标题与带数字后缀的标题不会产生相同 ID", () => {
    const rendered = renderMarkdown("## same\n\n## same\n\n## same-2\n\n## same");
    assert.deepEqual(rendered.toc.map((entry) => entry.id), ["same", "same-2", "same-2-2", "same-3"]);
});

test("摘要使用开篇可读文字，保留泛型并避免截断 Unicode 字符", () => {
    assert.equal(summarizeMarkdown("```java\n代码不进入摘要\n```\n\n- **传播**使用 `REQUIRES_NEW`。\n- [集合](https://example.com)为 `List<String>`。\n\n后文。"), "传播使用 REQUIRES_NEW。 集合为 List<String>。");
    assert.equal(summarizeMarkdown("字".repeat(159) + "😀结尾"), "字".repeat(159) + "😀…");
});

test("表格保持原生语义，Markdown 与旧 HTML 都由外层容器提供滚动", () => {
    for (const markdown of ["| 名称 | 数量 |\n| --- | ---: |\n| 示例 | 1 |", '<table border="1"><tr><td onclick="bad()">内容</td></tr></table>']) {
        const { html } = renderMarkdown(markdown);
        assert.match(html, /<div class="table-scroll" tabindex="0" role="region" aria-label="表格"><table>/);
        assert.match(html, /<\/table>\s*<\/div>/);
        assert.doesNotMatch(html, /onclick|border="1"/);
    }
});

test("代码的增强按钮初始隐藏，复制源保留原文字且不执行 HTML", () => {
    const { html } = renderMarkdown('```html\n<script>alert("code")</script>\n```');
    assert.match(html, /class="code-copy"[^>]* hidden/);
    assert.match(html, /&lt;script&gt;alert\(&quot;code&quot;\)&lt;\/script&gt;/);
    assert.match(html, /<p class="code-feedback" hidden><\/p>/);
    assert.doesNotMatch(html, /<script>/);
});

test("展示 HTML 保留，事件和可执行嵌入不输出，危险链接协议拒绝", () => {
    const { html } = renderMarkdown('<details open><summary>说明</summary>正文</details>\n\n<script>alert(1)</script>\n\n<img src="/image.png" onerror="bad()">');
    assert.match(html, /<details open="">/);
    assert.match(html, /<img src="\/image.png">/);
    assert.doesNotMatch(html, /script|alert|onerror/);
    for (const markdown of ['[链接](javascript:alert)', '<a href="javascript:alert(1)">链接</a>', '![图片](data:text/html,bad)']) {
        assert.throws(() => renderMarkdown(markdown), /不支持的链接协议/);
    }
});

test("独立公式生成原生 MathML，代码里的公式分隔符保持原文", () => {
    const { html } = renderMarkdown("$$\nO(\\text{offset} + \\text{size})\n$$\n\n```text\n$$\nO(N)\n$$\n```\n\n行内代码 `$$`。");
    assert.equal(html.match(/<math\b/g)?.length, 1);
    assert.match(html, /<mtext>offset<\/mtext>/);
    assert.match(html, /<code class="language-text">\$\$\nO\(N\)\n\$\$\n<\/code>/);
    assert.match(html, /<code>\$\$<\/code>/);
    assert.doesNotMatch(html, /<(?:script|link|style)\b/);
});
