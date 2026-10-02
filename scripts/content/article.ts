/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { Marked } from 'marked';
import { parse } from 'yaml';
import { summarizeMarkdown } from '../markdown/text.ts';

// 文章直接发布到根路径，这些名称已由站点页面、资源或平台端点使用。
const reservedIds = new Set(['archives', 'assets', 'favicon', 'index', '404', 'rss', 'sitemap', 'robots', 'apple-touch-icon', 'cdn-cgi']);

/**
 * 文章包中的公开文件，输出位置相对于 dist，使用 URL 的正斜线分隔。
 */
export interface ArticleAsset {
  sourcePath: string;
  outputPath: string;
  imageSize?: { width: number; height: number };
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
function validateDate(value: unknown, filePath: string): string {
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
 * 文章目录名由读取层显式传入，作为唯一标识；日期与标题只作为内容元数据。
 */
export function parseArticle(markdown: string, filePath: string, id: string): Article {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(filePath + ': 文章目录名须使用小写英文、数字和连字符');
  }
  if (reservedIds.has(id)) throw new Error(filePath + ': 文章目录名与站点保留路径冲突：' + id);

  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error(filePath + ': 缺少 YAML front matter');
  const parsed: unknown = parse(match[1] ?? '');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(filePath + ': front matter 必须是键值对象');
  }
  const metadata = parsed as Record<string, unknown>;
  if (metadata['id'] !== undefined) throw new Error(filePath + ': 文章标识由目录名决定，front matter 不填写 id');
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

  const url = '/' + id + '/';

  const body = markdown.slice(match[0].length);
  if (!body.trim()) throw new Error(filePath + ': 正文为空');
  const parser = new Marked();
  parser.walkTokens(parser.lexer(body), token => {
    if (token.type === 'heading' && token.depth === 1) throw new Error(filePath + ': 正文标题应从二级标题开始');
  });
  return { title, date, updated, id, url, domain, tags, markdown: body, filePath, summary: summarizeMarkdown(body), assets: [] };
}
