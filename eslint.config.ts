/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig, globalIgnores } from "eslint/config";
import base, { browser, node, typeChecked } from "@allurx/web-foundation/eslint";

export default defineConfig(
    // 正文与附件保留原始字节，生成物和本地资料不进入源码检查。
    globalIgnores(["articles/", "dist/", "node_modules/", ".vite/", ".wrangler/", ".certs/", "work/"]),
    base,
    {
        files: ["**/*.ts"],
        extends: [typeChecked],
        languageOptions: {
            parserOptions: { tsconfigRootDir: import.meta.dirname },
        },
    },
    { files: ["src/**/*.ts"], extends: [browser] },
    { files: ["scripts/**/*.ts", "*.ts"], extends: [node] }
);
