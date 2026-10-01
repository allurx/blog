import "./styles.css";

type Theme = "system" | "light" | "dark";
const themeSelect = document.querySelector<HTMLSelectElement>("#theme-select");
let theme: Theme = document.documentElement.dataset.theme === "light" ? "light"
    : document.documentElement.dataset.theme === "dark" ? "dark" : "system";

function applyTheme(): void {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    if (themeSelect) themeSelect.value = theme;
}

function restoreTheme(): void {
    try {
        const saved = localStorage.getItem("blog-theme");
        theme = saved === "light" || saved === "dark" ? saved : "system";
    } catch { /* 存储不可用时保留当前页面的选择。 */ }
    applyTheme();
}

applyTheme();
if (themeSelect) {
    const control = themeSelect.closest<HTMLElement>(".theme-control");
    if (control) control.hidden = false;
    themeSelect.addEventListener("change", () => {
        theme = themeSelect.value as Theme;
        applyTheme();
        try { localStorage.setItem("blog-theme", theme); }
        catch { /* 主题仍在当前页面生效。 */ }
    });
}
window.addEventListener("pageshow", restoreTheme);
window.addEventListener("storage", (event) => {
    if (event.key === "blog-theme" || event.key === null) restoreTheme();
});

// 筛选只改变静态文章列表的可见性，URL 保存可分享及返回恢复的条件。
const search = document.querySelector<HTMLInputElement>("#search");
const domain = document.querySelector<HTMLSelectElement>("#domain-filter");
const filters = document.querySelector<HTMLFormElement>(".article-filters");
const clearFilters = document.querySelector<HTMLButtonElement>("#clear-filters");
const count = document.querySelector<HTMLElement>("#article-count");
const empty = document.querySelector<HTMLElement>("#empty-state");
const rows = [...document.querySelectorAll<HTMLElement>(".article-row")].map((element) => ({
    element,
    searchable: element.textContent?.toLocaleLowerCase() ?? "",
}));

function filterArticles(updateUrl = true): void {
    const query = search?.value.trim() ?? "";
    const selectedDomain = domain?.value ?? "";
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const { element, searchable } of rows) {
        element.hidden = !terms.every((term) => searchable.includes(term))
            || !!selectedDomain && element.dataset.domain !== selectedDomain;
        if (!element.hidden) visible++;
    }
    const filtered = !!query || !!selectedDomain;
    if (count) count.textContent = filtered ? `找到 ${visible} 篇文章` : `共 ${visible} 篇文章`;
    if (empty) empty.hidden = visible !== 0;
    if (clearFilters) clearFilters.hidden = !filtered;

    if (updateUrl) {
        const url = new URL(location.href);
        for (const [key, value] of [["q", query], ["domain", selectedDomain]]) {
            if (value) url.searchParams.set(key, value);
            else url.searchParams.delete(key);
        }
        history.replaceState(history.state, "", url);
    }
}

function restoreFilters(): void {
    const params = new URL(location.href).searchParams;
    if (search) search.value = params.get("q") ?? "";
    if (domain) domain.value = params.get("domain") ?? "";
    filterArticles(false);
}

if (search && filters) {
    filters.hidden = false;
    restoreFilters();
    filters.addEventListener("submit", (event) => {
        event.preventDefault();
        filterArticles();
    });
    search.addEventListener("input", (event) => {
        if (!(event as InputEvent).isComposing) filterArticles();
    });
    search.addEventListener("compositionend", () => filterArticles());
    domain?.addEventListener("change", () => filterArticles());
    clearFilters?.addEventListener("click", () => {
        search.value = "";
        if (domain) domain.value = "";
        filterArticles();
        search.focus();
    });
    window.addEventListener("pageshow", restoreFilters);
    window.addEventListener("popstate", restoreFilters);
}

// 反馈留在对应代码块附近，同时向辅助技术播报操作结果。
const copyStatus = document.querySelector<HTMLElement>("#copy-status");
for (const button of document.querySelectorAll<HTMLButtonElement>(".code-copy")) {
    const block = button.closest(".code-block");
    const code = block?.querySelector("code");
    const feedback = block?.querySelector<HTMLElement>(".code-feedback");
    if (!code || !feedback) continue;
    let resetTimer: number | undefined;
    button.hidden = false;
    button.addEventListener("click", async () => {
        window.clearTimeout(resetTimer);
        button.disabled = true;
        button.textContent = "复制中…";
        feedback.hidden = true;
        try {
            await navigator.clipboard.writeText(code.textContent ?? "");
            button.textContent = "已复制";
            feedback.textContent = "已复制到剪贴板。";
            feedback.dataset.result = "success";
            resetTimer = window.setTimeout(() => {
                button.textContent = "复制";
                feedback.hidden = true;
            }, 2200);
        } catch {
            button.textContent = "复制";
            feedback.textContent = "自动复制未成功，请选择代码后手动复制。";
            feedback.dataset.result = "error";
        } finally {
            button.disabled = false;
            feedback.hidden = false;
            copyStatus?.replaceChildren(document.createTextNode(feedback.textContent ?? ""));
        }
    });
}

// 目录只有一份 DOM；宽度变化只设置默认开合，点击仍由原生 details 处理。
const toc = document.querySelector<HTMLDetailsElement>(".toc details");
if (toc) {
    const wide = matchMedia("(min-width: 68rem)");
    const adaptToc = () => { toc.open = wide.matches; };
    adaptToc();
    wide.addEventListener("change", adaptToc);
}
