/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 静态目录保留原生弹出层和锚点；脚本只补充阅读位置、目录定位和焦点衔接。
 */
export function initializeArticleToc(): void {
    const toc = document.querySelector<HTMLElement>(".toc");
    if (!toc) return;

    const list = toc.querySelector<HTMLElement>(".toc-list")!;
    const sections = [...list.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].flatMap((link) => {
        const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        return heading ? [{ link, heading }] : [];
    });
    let currentLink: HTMLAnchorElement | undefined;
    let frame: number | undefined;

    // 只更新标记，不在正文滚动时强行改变用户正在浏览的目录位置。
    const updateCurrentSection = () => {
        frame = undefined;
        const sectionBoundary = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
        const atEnd = window.scrollY > 0 && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight;
        // 短末节到不了判定线时仍标记末节；原生锚点允许不足一个 CSS 像素的舍入差异。
        const current = atEnd ? sections.at(-1)?.link
            : sections.findLast(({ heading }) => heading.getBoundingClientRect().top < sectionBoundary + 1)?.link ?? sections[0]?.link;
        if (current === currentLink) return;
        currentLink?.removeAttribute("aria-current");
        current?.setAttribute("aria-current", "location");
        currentLink = current;
    };
    const scheduleUpdate = () => {
        if (frame === undefined) frame = requestAnimationFrame(updateCurrentSection);
    };
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", scheduleUpdate);
    window.addEventListener("pageshow", scheduleUpdate);
    updateCurrentSection();

    // 只滚动目录列表，避免 scrollIntoView 连带移动正文。
    const locateCurrentSection = () => {
        if (!currentLink) return;
        const row = currentLink.getBoundingClientRect();
        const viewport = list.getBoundingClientRect();
        list.scrollTop += row.top - viewport.top - (list.clientHeight - row.height) / 2;
    };
    if (!("showPopover" in HTMLElement.prototype)) return;
    toc.addEventListener("toggle", () => {
        if (!toc.matches(":popover-open")) return;
        // 每次打开后定位当前章节；面板打开期间的正文滚动只更新标记。
        requestAnimationFrame(() => {
            if (!toc.matches(":popover-open")) return;
            if (frame !== undefined) cancelAnimationFrame(frame);
            updateCurrentSection();
            locateCurrentSection();
        });
    });

    // 选章沿用链接的默认滚动和历史记录；收起后将键盘阅读起点交给目标标题。
    list.addEventListener("click", (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a") : null;
        const section = sections.find((entry) => entry.link === link);
        if (!section || !toc.matches(":popover-open")) return;
        toc.hidePopover();
        const hadTabIndex = section.heading.hasAttribute("tabindex");
        if (!hadTabIndex) {
            section.heading.tabIndex = -1;
            section.heading.addEventListener("blur", () => section.heading.removeAttribute("tabindex"), { once: true });
        }
        section.heading.focus({ preventScroll: true });
    });
}
