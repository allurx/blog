import { readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { site } from '../../site.config.ts';
import { checkLocalLinks } from './links.ts';
import { renderSite } from './pages.ts';
import { readSite } from './site.ts';

const contentTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.java': 'text/plain; charset=utf-8', '.sh': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.json': 'application/json',
};

/**
 * 页面在内存中生成，文章资源按生产地址读取；Vite 继续负责浏览器模块和样式。
 */
export function articlePages(root: string): Plugin {
  return {
    name: 'blog:pages',
    apply: 'serve',
    async configureServer(server) {
      async function generate() {
        const content = await readSite(root);
        const documents = renderSite(content.articles, { script: '/src/client/main.ts', styles: [] });
        checkLocalLinks(documents, [...content.files.map(file => file.outputPath), 'src/client/main.ts'], site.url);
        const resources = new Map(content.articles.flatMap(article => article.assets).map(file => [file.outputPath, file.sourcePath]));
        return { documents, resources };
      }

      let current = await generate();
      let regeneration = Promise.resolve();

      // 正文与资源共用刷新入口；编辑过程中校验失败时保留上一版页面并显示错误。
      const refresh = (path: string): void => {
        const input = relative(root, path).replaceAll('\\', '/');
        if (!input.startsWith('articles/') && !input.startsWith('public/')) return;
        regeneration = regeneration.then(async () => {
          try {
            current = await generate();
            server.ws.send({ type: 'full-reload' });
          } catch (error) {
            server.config.logger.error(String(error));
            server.ws.send({ type: 'error', err: { message: String(error), stack: '' } });
          }
        });
      };
      server.watcher.add([join(root, 'articles'), join(root, 'public')]);
      for (const event of ['add', 'change', 'unlink'] as const) server.watcher.on(event, refresh);
      server.httpServer?.once('close', () => {
        for (const event of ['add', 'change', 'unlink'] as const) server.watcher.off(event, refresh);
      });

      return () => {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url || !['GET', 'HEAD'].includes(request.method ?? '')) return next();
          try {
            const url = new URL(request.url, 'http://localhost');
            let path = decodeURIComponent(url.pathname).slice(1);
            const resource = current.resources.get(path);
            if (resource) {
              const body = await readFile(resource);
              response.setHeader('Content-Type', contentTypes[extname(resource).toLowerCase()] ?? 'application/octet-stream');
              response.setHeader('Cache-Control', 'no-cache');
              response.end(request.method === 'HEAD' ? undefined : body);
              return;
            }

            if (!path || path.endsWith('/')) path += 'index.html';
            if (current.documents.has(path + '/index.html')) {
              response.statusCode = 308;
              response.setHeader('Location', url.pathname + '/' + url.search);
              response.end();
              return;
            }
            const found = current.documents.get(path);
            const html = path.endsWith('.html') || found === undefined;
            const document = found ?? current.documents.get('404.html')!;
            response.statusCode = found === undefined || path === '404.html' ? 404 : 200;
            response.setHeader('Content-Type', html ? 'text/html; charset=utf-8' : 'application/xml; charset=utf-8');
            const body = html ? await server.transformIndexHtml(url.pathname, document) : document;
            response.end(request.method === 'HEAD' ? undefined : body);
          } catch (error) { next(error); }
        });
      };
    },
  };
}
