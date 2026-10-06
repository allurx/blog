/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import foundation from "@allurx/web-foundation/vite";
import { articlePages } from "./scripts/dev-plugin.ts";

const root = fileURLToPath(new URL(".", import.meta.url));

export default mergeConfig(foundation, {
    root,
    // 样式独立于渐进增强脚本，使开发与生产页面都能在首次绘制前加载 CSS。
    input: ["src/main.ts", "src/styles.css"],
    appType: "custom",
    plugins: [articlePages(root)],
    server: { port: 5174, strictPort: true },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        copyPublicDir: false,
        manifest: true,
    },
});
