import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Marked } from 'marked';
import { parse } from 'yaml';
import { summarizeMarkdown } from './markdown.ts';

/**
 * 文章包中的公开文件，输出位置相对于 dist，使用 URL 的正斜线分隔。
 */
export interface ArticleAsset {
  sourcePath: string;
  outputPath: string;
}

export interface Article {
  title: string;
  date: string;
  updated?: string;
  id: string;
  url: string;
  domain: string;
  tags: string[];
  markdown: string;
  filePath: string;
  summary: string;
  assets: ArticleAsset[];
}

/**
 * 日期使用实际公历日期，不接受 Date 自动归一化后的其他日期。
 */
export function validateDate(value: unknown, filePath: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(filePath + ': 日期必须采用 YYYY-MM-DD');
  }
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(filePath + ': 无效日期 ' + value);
  }
  return value;
}

function requiredText(value: unknown, field: string, filePath: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(filePath + ': 缺少 ' + field);
  return value.trim();
}

/**
 * 所有文章共用 YAML 元数据，由稳定 ID 生成唯一文章地址。
 */
export function parseArticle(markdown: string, filePath: string): Article {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error(filePath + ': 缺少 YAML front matter');
  const parsed: unknown = parse(match[1] ?? '');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(filePath + ': front matter 必须是键值对象');
  }
  const metadata = parsed as Record<string, unknown>;
  const title = requiredText(metadata['title'], 'title', filePath);
  const date = validateDate(metadata['date'], filePath);
  const updated = metadata['updated'] === undefined ? undefined : validateDate(metadata['updated'], filePath + ': updated');
  if (updated && updated < date) throw new Error(filePath + ': updated 不得早于原发表日期');
  const domain = requiredText(metadata['domain'], 'domain', filePath);
  const values = metadata['tags'];
  if (!Array.isArray(values) || !values.every(tag => typeof tag === 'string')) {
    throw new Error(filePath + ': tags 必须是字符串数组');
  }
  const tags = values.map(tag => requiredText(tag, 'tags', filePath));
  if (tags.some(tag => tag.startsWith('#'))) throw new Error(filePath + ': tags 不带 # 前缀');

  const id = requiredText(metadata['id'], 'id', filePath);
  if (!new RegExp('^' + date + '-[a-z0-9]+(?:-[a-z0-9]+)*$').test(id)) {
    throw new Error(filePath + ': ID 应以文章日期开头并采用小写 topic-slug');
  }
  const url = '/articles/' + id + '/';

  const body = markdown.slice(match[0].length);
  if (!body.trim()) throw new Error(filePath + ': 正文为空');
  const parser = new Marked();
  parser.walkTokens(parser.lexer(body), token => {
    if (token.type === 'heading' && token.depth === 1) throw new Error(filePath + ': 正文标题应从二级标题开始');
  });
  return { title, date, updated, id, url, domain, tags, markdown: body, filePath, summary: summarizeMarkdown(body), assets: [] };
}

/**
 * 地址由 ID 唯一决定，重复 ID 不能覆盖已生成文章。
 */
export function validateArticles(articles: Article[]): void {
  const ids = new Set<string>();
  for (const article of articles) {
    if (ids.has(article.id)) throw new Error(article.filePath + ': 重复文章 ID ' + article.id);
    ids.add(article.id);
  }
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
    else if (entry.isFile()) assets.push({ sourcePath, outputPath });
    else throw new Error(sourcePath + ': 文章资源必须是普通文件或目录');
  }
  return assets;
}

/**
 * 正文只从 articles/YYYY-MM/ID/index.md 读取，资源与文章共同维护。
 */
export async function readArticles(root: string): Promise<Article[]> {
  const directory = resolve(root, 'articles');
  const months = await readdir(directory, { withFileTypes: true });
  const articles: Article[] = [];
  for (const month of months.sort((a, b) => a.name.localeCompare(b.name))) {
    const monthPath = join(directory, month.name);
    if (!month.isDirectory() || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.name)) {
      throw new Error(monthPath + ': 文章必须放在 YYYY-MM 月份目录中');
    }

    const packages = await readdir(monthPath, { withFileTypes: true });
    for (const entry of packages.sort((a, b) => a.name.localeCompare(b.name))) {
      const articlePath = join(monthPath, entry.name);
      if (!entry.isDirectory()) throw new Error(articlePath + ': 文章必须放在以 ID 命名的目录中');

      const filePath = join(articlePath, 'index.md');
      const article = parseArticle(await readFile(filePath, 'utf8'), filePath);
      if (article.date.slice(0, 7) !== month.name) throw new Error(filePath + ': 月份目录必须与发表日期一致');
      if (article.id !== entry.name) throw new Error(filePath + ': 文章目录名必须与 ID 一致');
      article.assets = await articleAssets(articlePath, 'articles/' + article.id);
      articles.push(article);
    }
  }

  validateArticles(articles);
  return articles.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'));
}
