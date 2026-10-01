import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArticle, validateArticles } from './content.ts';

function article(date = '2026-09-30', slug = 'topic'): string {
  return '---\ntitle: 技术主题\ndate: ' + date + '\nid: ' + date + '-' + slug + '\ndomain: JVM\ntags: [Java, JVM, GC]\n---\n\n从具体问题开始，说明适用边界。\n\n## 共享状态\n\n具体内容。\n';
}

test('统一元数据保留日期、自由正文与 ID 对应的文章地址', () => {
  const parsed = parseArticle(article(), 'article.md');
  assert.equal(parsed.url, '/articles/2026-09-30-topic/');
  assert.equal(parsed.date, '2026-09-30');
  assert.equal(parsed.title, '技术主题');
  assert.deepEqual(parsed.tags, ['Java', 'JVM', 'GC']);
  assert.equal(parsed.markdown, '\n从具体问题开始，说明适用边界。\n\n## 共享状态\n\n具体内容。\n');
  assert.equal(parsed.summary, '从具体问题开始，说明适用边界。');
  assert.doesNotThrow(() => parseArticle(article().replace('## 共享状态\n\n具体内容。\n', ''), 'article.md'));
});

test('必要元数据、标签、日期、ID 与正文层级均有明确边界', () => {
  assert.throws(() => parseArticle(article('2026-02-30'), 'invalid.md'), /无效日期/);
  assert.throws(() => parseArticle(article().replace('id: 2026-09-30-topic', 'id: 2026-09-29-topic'), 'invalid.md'), /ID 应/);
  for (const field of ['title', 'date', 'id', 'domain', 'tags']) {
    assert.throws(() => parseArticle(article().replace(new RegExp('^' + field + ':.*\\n', 'm'), ''), 'invalid.md'));
  }
  for (const tags of ['Java', '[Java, 42]', '[[Java]]', "[Java, ' ']", "['#Java']"]) {
    assert.throws(() => parseArticle(article().replace('[Java, JVM, GC]', tags), 'invalid.md'), /tags/);
  }
  assert.throws(() => parseArticle(article().replace('## 共享状态', '# 共享状态'), 'invalid.md'), /正文标题/);
  assert.throws(() => parseArticle(article() + '\n> # 引用中的一级标题\n', 'invalid.md'), /正文标题/);
  assert.throws(() => parseArticle(article().replace(/---\n\n[\s\S]*$/, '---\n\n  \n'), 'invalid.md'), /正文为空/);
  assert.doesNotThrow(() => parseArticle(article() + '\n\x60\x60\x60md\n# 代码中的标题\n\x60\x60\x60\n', 'article.md'));
});

test('修订日期可省略，提供时必须有效且不早于原发表日期', () => {
  assert.equal(parseArticle(article(), 'article.md').updated, undefined);
  for (const updated of ['2026-09-30', '2026-10-01']) {
    const parsed = parseArticle(article().replace('date: 2026-09-30', 'date: 2026-09-30\nupdated: ' + updated), 'article.md');
    assert.equal(parsed.date, '2026-09-30');
    assert.equal(parsed.updated, updated);
  }
  assert.throws(() => parseArticle(article().replace('date: 2026-09-30', 'date: 2026-09-30\nupdated: 2026-09-29'), 'invalid.md'), /不得早于/);
  assert.throws(() => parseArticle(article().replace('date: 2026-09-30', 'date: 2026-09-30\nupdated: 2026-09-31'), 'invalid.md'), /updated.*无效日期/);
});

test('文章 ID 不可重复，普通文章允许同日发表', () => {
  const first = parseArticle(article(), 'first.md');
  assert.throws(() => validateArticles([first, {...first, filePath: 'second.md'}]), /重复/);
  assert.doesNotThrow(() => validateArticles([first, parseArticle(article('2026-09-30', 'other'), 'other.md')]));
});
