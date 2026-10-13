/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 原生 details 负责工具开合；只在布局切换时调整默认值，并保护目录和焦点。
 */
export function initializePageTools(): void {
    const toolbox = document.querySelector<HTMLDetailsElement>(".page-tools");
    if (!toolbox) return;

    const summary = toolbox.querySelector<HTMLElement>("summary");
    const actions = toolbox.querySelector<HTMLElement>(".page-tools-actions");
    if (!summary || !actions) throw new Error("页面工具缺少开关或操作容器");
    const toc = document.querySelector<HTMLElement>(".toc");
    const narrow = window.matchMedia("(width < 82rem)");
    const closeToc = () => {
        if (!toc || !("hidePopover" in HTMLElement.prototype) || !toc.matches(":popover-open")) return false;
        toc.hidePopover();
        return true;
    };
    const adaptTools = () => {
        delete toolbox.dataset["motionReady"];
        const focusedInside = toolbox.contains(document.activeElement);
        const closedToc = narrow.matches && closeToc();
        toolbox.open = !narrow.matches;
        if (narrow.matches && (focusedInside || closedToc)) summary.focus({ preventScroll: true });
    };

    toolbox.addEventListener("toggle", () => {
        // 退出过渡只保留画面，已收起的链接不能继续接收焦点或点击。
        actions.inert = !toolbox.open;
        if (!toolbox.open && closeToc()) summary.focus({ preventScroll: true });
    });
    // 仅在用户开始操作后启用过渡，桌面初始展开保持静态。
    const enableMotion = () => {
        toolbox.dataset["motionReady"] = "";
    };
    toolbox.addEventListener("pointerdown", enableMotion);
    toolbox.addEventListener("keydown", enableMotion);
    // 目录已将焦点交给目标章节后收起临时工具，避免继续遮住正文。
    toc?.addEventListener("click", (event) => {
        if (!narrow.matches || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
        if (event.target instanceof Element && event.target.closest('.toc-list a[href^="#"]')) toolbox.open = false;
    });
    narrow.addEventListener("change", adaptTools);
    actions.inert = !toolbox.open;
}
