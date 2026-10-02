/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

export type IconName = "search" | "file" | "archive" | "sun" | "moon" | "monitor"
    | "chevron-down" | "filter" | "arrow-left" | "arrow-right" | "arrow-up" | "arrow-down" | "copy" | "check"
    | "close" | "github" | "rss" | "table-of-contents" | "more-horizontal";

const shapes: Record<IconName, string> = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9L14 3Zm0 0v6h6M8 13h8m-8 4h5"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8m-9 4h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3.5a8.5 8.5 0 1 0 10 10Z"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/>',
    "arrow-left": '<path d="M20 12H4m6-6-6 6 6 6"/>',
    "arrow-right": '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    "arrow-up": '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    "arrow-down": '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    "table-of-contents": '<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
    "more-horizontal": '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    github: '<path d="M8.5 20v-3c-3 .8-3.9-1.5-4.8-1.5M15.5 20v-3.6c0-.8-.3-1.4-.8-1.8 2.8-.3 5.3-1.4 5.3-5.4 0-1.1-.4-2.1-1.2-2.9.3-1 .3-2.1-.1-3.1 0 0-1.2-.3-3.3 1.1a11 11 0 0 0-6.8 0C6.5 2.9 5.3 3.2 5.3 3.2c-.4 1-.4 2.1-.1 3.1C4.4 7.1 4 8.1 4 9.2c0 4 2.5 5.1 5.3 5.4-.5.4-.8 1-.8 1.8V20"/>',
    rss: '<circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/>',
};

/**
 * 图标仅作视觉补充；链接和按钮的可访问名称由调用处提供。
 */
export function icon(name: IconName): string {
    return `<svg class="icon icon-${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes[name]}</svg>`;
}
