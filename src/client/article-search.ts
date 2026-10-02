/**
 * 筛选静态文章列表，以 URL 保存可分享及浏览器返回后恢复的条件。
 */
export function initializeArticleSearch(): void {
    const search = document.querySelector<HTMLInputElement>("#search");
    const filters = document.querySelector<HTMLFormElement>(".article-filters");
    if (!search || !filters) return;

    const domain = document.querySelector<HTMLSelectElement>("#domain-filter");
    const clearFilters = document.querySelector<HTMLButtonElement>("#clear-filters");
    const count = document.querySelector<HTMLElement>("#article-count");
    const empty = document.querySelector<HTMLElement>("#empty-state");
    const rows = [...document.querySelectorAll<HTMLElement>(".article-row")].map((element) => ({
        element,
        searchable: (element.dataset.search ?? element.textContent ?? "").toLocaleLowerCase(),
    }));

    const filterArticles = (updateUrl = true): void => {
        const query = search.value.trim();
        const selectedDomain = domain?.value ?? "";
        const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
        let visible = 0;
        for (const { element, searchable } of rows) {
            element.hidden = !terms.every((term) => searchable.includes(term))
                || !!selectedDomain && element.dataset.domain !== selectedDomain;
            if (!element.hidden) visible++;
        }

        const filtered = !!query || !!selectedDomain;
        if (count) {
            count.textContent = filtered ? `${visible} / ${rows.length} 篇` : `${rows.length} 篇`;
            count.setAttribute("aria-label", filtered ? `共 ${rows.length} 篇文章，找到 ${visible} 篇` : `共 ${rows.length} 篇文章`);
        }
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
    };

    const restoreFilters = (): void => {
        const params = new URL(location.href).searchParams;
        search.value = params.get("q") ?? "";
        if (domain) domain.value = params.get("domain") ?? "";
        filterArticles(false);
    };

    filters.hidden = false;
    filters.closest<HTMLElement>(".collection-toolbar")?.removeAttribute("hidden");
    restoreFilters();
    filters.addEventListener("submit", (event) => {
        event.preventDefault();
        filterArticles();
    });
    search.addEventListener("input", (event) => {
        if (!(event as InputEvent).isComposing) filterArticles();
    });
    search.addEventListener("compositionend", () => filterArticles());
    search.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.isComposing || !search.value) return;
        event.preventDefault();
        search.value = "";
        filterArticles();
    });
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
