/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 筛选静态文章列表，以 URL 保存可分享及浏览器返回后恢复的条件。
 */
export function initializeArticleSearch(): void {
    const search = document.querySelector<HTMLInputElement>("#search");
    const filters = document.querySelector<HTMLFormElement>(".article-filters");
    if (!search || !filters) return;

    const domain = document.querySelector<HTMLDetailsElement>("#domain-filter");
    const domainSummary = domain?.querySelector("summary");
    const domainPanel = domain?.querySelector<HTMLElement>(".domain-options");
    const domainSelection = document.querySelector<HTMLElement>("#domain-selection");
    const domainOptions = [...filters.querySelectorAll<HTMLInputElement>('input[name="domain"]')];
    const clearFilters = document.querySelector<HTMLButtonElement>("#clear-filters");
    const clearDomains = document.querySelector<HTMLButtonElement>("#clear-domains");
    const count = document.querySelector<HTMLElement>("#article-count");
    const empty = document.querySelector<HTMLElement>("#empty-state");
    const rows = [...document.querySelectorAll<HTMLElement>(".article-row")].map((element) => ({
        element,
        searchable: (element.dataset["search"] ?? element.textContent).toLocaleLowerCase(),
    }));

    // 普通 details 不会像原生 select 自动避让视口，按入口两侧的实际空间限制弹层。
    const fitDomainMenu = (): void => {
        if (!domain?.open) return;
        const bounds = domain.getBoundingClientRect();
        const below = window.innerHeight - bounds.bottom;
        const above = bounds.top;
        const openAbove = above > below;
        domain.dataset["placement"] = openAbove ? "above" : "below";
        domain.style.setProperty("--domain-space", `${Math.max(0, openAbove ? above : below)}px`);
    };

    // 退场动画会暂时保留可见内容；原生 open 状态关闭后立即停止内部交互。
    const synchronizeDomainPanel = (): void => {
        if (domainPanel) domainPanel.inert = !domain?.open;
        fitDomainMenu();
    };
    for (const group of filters.querySelectorAll<HTMLDetailsElement>(".domain-group")) {
        const choices = group.querySelector<HTMLElement>(".domain-choices");
        if (!choices) throw new Error("领域分组缺少选项容器");
        const synchronizeChoices = () => {
            choices.inert = !group.open;
        };
        group.addEventListener("toggle", synchronizeChoices);
        synchronizeChoices();
    }

    const filterArticles = (updateUrl = true): void => {
        const query = search.value.trim();
        const selectedDomains = new Set(
            domainOptions.filter((option) => option.checked && !option.disabled).map((option) => option.value)
        );
        const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
        let visible = 0;
        for (const { element, searchable } of rows) {
            element.hidden =
                !terms.every((term) => searchable.includes(term)) ||
                (selectedDomains.size > 0 && !selectedDomains.has(element.dataset["domain"] ?? ""));
            if (!element.hidden) visible++;
        }

        const filtered = !!query || selectedDomains.size > 0;
        if (domainSelection)
            domainSelection.textContent = selectedDomains.size ? `已选 ${selectedDomains.size} 个领域` : "全部领域";
        if (count) {
            count.textContent = filtered ? `${visible} / ${rows.length} 篇` : `${rows.length} 篇`;
            count.setAttribute(
                "aria-label",
                filtered ? `共 ${rows.length} 篇文章，找到 ${visible} 篇` : `共 ${rows.length} 篇文章`
            );
        }
        if (empty) empty.hidden = visible !== 0;
        if (clearFilters) clearFilters.hidden = !filtered;
        if (clearDomains) clearDomains.disabled = selectedDomains.size === 0;

        if (updateUrl) {
            const url = new URL(location.href);
            if (query) url.searchParams.set("q", query);
            else url.searchParams.delete("q");
            url.searchParams.delete("domain");
            for (const selected of selectedDomains) url.searchParams.append("domain", selected);
            history.replaceState(history.state, "", url);
        }
    };

    const restoreFilters = (): void => {
        const params = new URL(location.href).searchParams;
        search.value = params.get("q") ?? "";
        const selectedDomains = new Set(params.getAll("domain"));
        for (const option of domainOptions) option.checked = !option.disabled && selectedDomains.has(option.value);
        if (domain) domain.open = false;
        filterArticles(false);
    };

    filters.addEventListener("submit", (event) => {
        event.preventDefault();
        filterArticles();
    });
    search.addEventListener("input", (event) => {
        if (!event.isComposing) filterArticles();
    });
    search.addEventListener("compositionend", () => {
        filterArticles();
    });
    search.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && domain?.open) return;
        if (event.key !== "Escape" || event.isComposing || !search.value) return;
        event.preventDefault();
        search.value = "";
        filterArticles();
    });
    domain?.addEventListener("change", () => {
        filterArticles();
    });
    domain?.addEventListener("toggle", synchronizeDomainPanel);
    window.addEventListener("resize", fitDomainMenu);
    window.addEventListener("scroll", fitDomainMenu, { passive: true });
    clearDomains?.addEventListener("click", () => {
        for (const option of domainOptions) option.checked = false;
        filterArticles();
    });
    document.addEventListener("pointerdown", (event) => {
        if (domain?.open && event.target instanceof Node && !domain.contains(event.target)) domain.open = false;
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.isComposing || !domain?.open) return;
        event.preventDefault();
        domain.open = false;
        domainSummary?.focus();
    });
    clearFilters?.addEventListener("click", () => {
        search.value = "";
        for (const option of domainOptions) option.checked = false;
        if (domain) domain.open = false;
        filterArticles();
        search.focus();
    });
    window.addEventListener("pageshow", restoreFilters);
    window.addEventListener("popstate", restoreFilters);

    restoreFilters();
    synchronizeDomainPanel();
    filters.closest<HTMLElement>(".collection-toolbar")?.removeAttribute("data-pending");
}
