/**
 * 为静态目录补充响应式开合和当前章节标记，保留原生锚点与滚动行为。
 */
export function initializeArticleToc(): void {
    const toc = document.querySelector<HTMLDetailsElement>(".toc details");
    if (!toc) return;

    // 目录只有一份 DOM；跨断点时保留正被键盘操作的链接。
    const wide = matchMedia("(min-width: 64rem)");
    const adaptToc = () => {
        const focusedLink = document.activeElement instanceof HTMLAnchorElement && toc.contains(document.activeElement);
        toc.open = wide.matches || focusedLink;
    };
    adaptToc();
    wide.addEventListener("change", adaptToc);

    const sections = [...toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].flatMap((link) => {
        const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        return heading ? [{ link, heading }] : [];
    });
    const siteHeader = document.querySelector<HTMLElement>(".site-header");
    let currentLink: HTMLAnchorElement | undefined;
    let frame: number | undefined;
    const updateCurrentSection = () => {
        frame = undefined;
        // 判定线跟随吸顶页头的实际位置，标题进入其下方留白时成为当前章节。
        const sectionBoundary = Math.max(0, siteHeader?.getBoundingClientRect().bottom ?? 0) + 24;

        // 短末节无法滚到判定线时，文档底部仍应标记最后一节。
        const atEnd = window.scrollY > 0 && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight;
        // 原生锚点滚动会按设备像素舍入，允许不足一个 CSS 像素的定位差异。
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
    scheduleUpdate();
}
