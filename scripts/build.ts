import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as buildAssets, type Manifest } from 'vite';
import { readArticles } from './content.ts';
import { renderSite } from './pages.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * 内容先通过校验，再构建带指纹的浏览器资源，最后生成完整静态页面。
 */
export async function buildSite(): Promise<void> {
  const [articles, about] = await Promise.all([
    readArticles(root),
    readFile(join(root, 'content', 'pages', 'about.md'), 'utf8'),
  ]);
  await buildAssets({ configFile: join(root, 'vite.config.ts') });

  const outputRoot = join(root, 'dist');
  const manifestPath = resolve(outputRoot, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const entry = manifest['src/main.ts'];
  if (!entry?.file) throw new Error('Vite manifest 缺少 src/main.ts 入口');
  const documents = renderSite(articles, about, {
    script: '/' + entry.file,
    styles: (entry.css ?? []).map(path => '/' + path),
  });

  for (const [path, document] of documents) {
    const destination = resolve(outputRoot, path);
    if (!destination.startsWith(outputRoot + sep)) throw new Error('页面路径超出 dist: ' + path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, document, 'utf8');
  }
  if (dirname(manifestPath) !== join(outputRoot, '.vite')) throw new Error('资源清单路径超出 dist/.vite');
  await unlink(manifestPath);
  await rmdir(dirname(manifestPath));
  console.log('生成 ' + articles.length + ' 篇文章，输出到 dist。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildSite();
}
