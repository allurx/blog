/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeTheme } from "./theme.ts";
import { initializeArticleSearch } from "./article-search.ts";
import { initializeCodeCopy } from "./code-copy.ts";
import { initializeArticleToc } from "./article-toc.ts";
import { initializePageTools } from "./page-tools.ts";

initializeTheme();
initializeArticleSearch();
initializeCodeCopy();
initializePageTools();
initializeArticleToc();
