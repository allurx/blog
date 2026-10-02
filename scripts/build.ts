/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyFile, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildAssets, type Manifest } from 'vite';
import { site } from '../site.config.ts';
import { checkLocalLinks } from './links.ts';
import { renderSite } from './pages.ts';
import { readSite } from './site.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const content = await readSite(root);
const initialStyles = await readFile(join(root, 'src/styles/initial-theme.css'), 'utf8');

// Vite 生成带指纹的浏览器资源，正文与文章附件使用稳定的文章目录。
await buildAssets({ configFile: join(root, 'vite.config.ts') });
const outputRoot = join(root, 'dist');
const manifestPath = join(outputRoot, '.vite', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
const entry = manifest['src/main.ts'];
const stylesheet = manifest['src/styles.css'];
if (!entry?.file) throw new Error('Vite manifest 缺少 src/main.ts 入口');
if (!stylesheet?.file) throw new Error('Vite manifest 缺少 src/styles.css 入口');
const documents = renderSite(content.articles, {
  script: '/' + entry.file,
  styles: ['/' + stylesheet.file],
  initialStyles,
});
const browserFiles = new Set(Object.values(manifest).flatMap(asset => [asset.file, ...(asset.css ?? []), ...(asset.assets ?? [])]));
checkLocalLinks(documents, [...content.files.map(file => file.outputPath), ...browserFiles], site.url);

// 按同一份清单发布全站资源、文章附件和许可证，不复制 Markdown 正文。
for (const asset of content.files) {
  const destination = join(outputRoot, asset.outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(asset.sourcePath, destination);
}
for (const [path, document] of documents) {
  const destination = join(outputRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, document, 'utf8');
}

await unlink(manifestPath);
await rmdir(dirname(manifestPath));
console.log('生成 ' + content.articles.length + ' 篇文章，输出到 dist。');
