import { copyFile, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildAssets, type Manifest } from 'vite';
import { site } from '../../site.config.ts';
import { checkLocalLinks } from './links.ts';
import { renderSite } from './pages.ts';
import { readSite } from './site.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const content = await readSite(root);

// Vite 生成带指纹的浏览器资源，正文与文章附件使用稳定的文章目录。
await buildAssets({ configFile: join(root, 'vite.config.ts') });
const outputRoot = join(root, 'dist');
const manifestPath = join(outputRoot, '.vite', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
const entry = manifest['src/client/main.ts'];
if (!entry?.file) throw new Error('Vite manifest 缺少 src/client/main.ts 入口');
const documents = renderSite(content.articles, {
  script: '/' + entry.file,
  styles: (entry.css ?? []).map(path => '/' + path),
});
const browserFiles = new Set(Object.values(manifest).flatMap(asset => [asset.file, ...(asset.css ?? []), ...(asset.assets ?? [])]));
checkLocalLinks(documents, [...content.files.map(file => file.outputPath), ...browserFiles], site.url);

// public 由 Vite 复制；此处只发布文章包里的资源和生成文档，不复制 Markdown 正文。
for (const asset of content.articles.flatMap(article => article.assets)) {
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
