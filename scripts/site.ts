/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ArticleAsset } from "./content/article.ts";
import { readArticles } from "./content/read.ts";

/**
 * 开发与生产共用内容和资源清单。文章资源按文章 URL 发布，全站资源与源码许可证保持根路径。
 */
export async function readSite(root: string) {
    const articles = await readArticles(root);
    const files: ArticleAsset[] = articles.flatMap((article) => article.assets);

    async function publicFiles(directory: string, prefix = ""): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const sourcePath = join(directory, entry.name);
            const outputPath = prefix + entry.name;
            if (entry.isDirectory()) await publicFiles(sourcePath, outputPath + "/");
            else if (entry.isFile()) files.push({ sourcePath, outputPath });
        }
    }

    await publicFiles(join(root, "public"));
    files.push({ sourcePath: join(root, "LICENSE.txt"), outputPath: "LICENSE.txt" });
    return { articles, files };
}
