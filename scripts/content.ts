import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Marked } from 'marked';
import { parse } from 'yaml';
import { summarizeMarkdown } from './markdown.ts';

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
  return { title, date, updated, id, url, domain, tags, markdown: body, filePath, summary: summarizeMarkdown(body) };
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

async function markdownFiles(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

export async function readArticles(root: string): Promise<Article[]> {
  const articles: Article[] = [];
  for (const path of await markdownFiles(join(root, 'content', 'articles'))) {
    articles.push(parseArticle(await readFile(path, 'utf8'), path));
  }
  validateArticles(articles);
  return articles.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'));
}
