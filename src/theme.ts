/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

type Theme = "system" | "light" | "dark";

/**
 * 同步主题选择、页面配色和本地偏好；存储不可用时仍支持当前页面切换。
 */
export function initializeTheme(): void {
    const select = document.querySelector<HTMLSelectElement>("#theme-select");
    const control = select?.closest<HTMLElement>(".theme-control");
    let theme: Theme = document.documentElement.dataset.theme === "light" ? "light"
        : document.documentElement.dataset.theme === "dark" ? "dark" : "system";

    function applyTheme(): void {
        if (theme === "system") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = theme;
        if (select) {
            select.value = theme;
            select.title = `主题：${{ system: "跟随系统", light: "浅色", dark: "深色" }[theme]}`;
        }
        if (control) control.dataset.theme = theme;
    }

    function restoreTheme(): void {
        try {
            const saved = localStorage.getItem("blog-theme");
            theme = saved === "light" || saved === "dark" ? saved : "system";
        } catch { /* 存储不可用时保留当前页面的选择。 */ }
        applyTheme();
    }

    applyTheme();
    control?.removeAttribute("data-pending");
    select?.addEventListener("change", () => {
        theme = select.value as Theme;
        applyTheme();
        try { localStorage.setItem("blog-theme", theme); }
        catch { /* 主题仍在当前页面生效。 */ }
    });
    window.addEventListener("pageshow", restoreTheme);
    window.addEventListener("storage", (event) => {
        if (event.key === "blog-theme" || event.key === null) restoreTheme();
    });
}
