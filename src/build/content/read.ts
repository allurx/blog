import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArticle, type Article, type ArticleAsset } from './article.ts';

async function readPngSize(sourcePath: string): Promise<{ width: number; height: number }> {
  const data = await readFile(sourcePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature) || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(sourcePath + ': 无法读取 PNG 尺寸');
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (!width || !height) throw new Error(sourcePath + ': PNG 尺寸无效');
  return { width, height };
}

/**
 * 只把文章包根的 index.md 作为正文；其余普通文件按包内路径原样发布。
 */
async function articleAssets(directory: string, outputDirectory: string, articleRoot = true): Promise<ArticleAsset[]> {
  const assets: ArticleAsset[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const sourcePath = join(directory, entry.name);
    if (articleRoot && entry.name === 'index.md') continue;
    if (articleRoot && entry.name.toLowerCase() === 'index.html') {
      throw new Error(sourcePath + ': 与生成的文章页面 index.html 冲突');
    }

    const outputPath = outputDirectory + '/' + entry.name;
    if (entry.isDirectory()) assets.push(...await articleAssets(sourcePath, outputPath, false));
    else if (entry.isFile()) {
      const asset: ArticleAsset = { sourcePath, outputPath };
      // 当前文章配图都是 PNG，IHDR 的真实尺寸让懒加载图片提前占位。
      if (entry.name.toLowerCase().endsWith('.png')) {
        asset.imageSize = await readPngSize(sourcePath);
      }
      assets.push(asset);
    }
    else throw new Error(sourcePath + ': 文章资源必须是普通文件或目录');
  }
  return assets;
}

/**
 * 每个 articles/<slug>/ 目录是一个完整文章包，目录名决定公开地址。
 */
export async function readArticles(root: string): Promise<Article[]> {
  const directory = resolve(root, 'articles');
  const packages = await readdir(directory, { withFileTypes: true });
  const articles: Article[] = [];
  for (const entry of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    const articlePath = join(directory, entry.name);
    if (!entry.isDirectory()) throw new Error(articlePath + ': 文章必须放在独立的主题目录中');

    const filePath = join(articlePath, 'index.md');
    const article = parseArticle(await readFile(filePath, 'utf8'), filePath, entry.name);
    article.assets = await articleAssets(articlePath, article.id);
    articles.push(article);
  }

  return articles.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'));
}
