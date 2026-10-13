/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { transformWithOxc } from "vite";

export const initialAssetPaths = {
    styles: "src/styles/initial-theme.css",
    search: "src/article-search.ts",
};

/**
 * 开发与生产共用首屏资源；筛选在静态结构解析后同步执行，不等待增强模块下载。
 */
export async function readInitialAssets(root: string): Promise<{ initialStyles: string; initialSearch: string }> {
    const searchPath = join(root, initialAssetPaths.search);
    const [initialStyles, searchSource] = await Promise.all([
        readFile(join(root, initialAssetPaths.styles), "utf8"),
        readFile(searchPath, "utf8"),
    ]);
    const search = await transformWithOxc(searchSource, searchPath, { sourceType: "script", sourcemap: false });

    return { initialStyles, initialSearch: search.code.replace(/<\/script/gi, "<\\/script") };
}
