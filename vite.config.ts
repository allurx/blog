import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { readArticles } from './scripts/content.ts';
import { renderSite } from './scripts/pages.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * 开发时在内存中生成页面；Vite 只处理浏览器资源，无中间 HTML 目录。
 */
function articlePages(): Plugin {
  return {
    name: 'blog:pages',
    apply: 'serve',
    async configureServer(server) {
      async function pages(): Promise<Map<string, string>> {
        const [articles, about] = await Promise.all([
          readArticles(root),
          readFile(join(root, 'content', 'pages', 'about.md'), 'utf8'),
        ]);
        return renderSite(articles, about, { script: '/src/main.ts', styles: [] });
      }
      let documents = await pages();
      let regeneration = Promise.resolve();

      // 一次只处理一轮内容变更；校验失败时保留仍可阅读的上次页面并显示错误。
      const refresh = (path: string): void => {
        const input = relative(root, path).replaceAll('\\', '/');
        if (!input.endsWith('.md') || !['content/articles/', 'content/pages/'].some(prefix => input.startsWith(prefix))) return;
        regeneration = regeneration.then(async () => {
          try {
            documents = await pages();
            server.ws.send({ type: 'full-reload' });
          } catch (error) {
            server.config.logger.error(String(error));
            server.ws.send({ type: 'error', err: { message: String(error), stack: '' } });
          }
        });
      };
      server.watcher.add(join(root, 'content'));
      for (const event of ['add', 'change', 'unlink'] as const) server.watcher.on(event, refresh);
      server.httpServer?.once('close', () => {
        for (const event of ['add', 'change', 'unlink'] as const) server.watcher.off(event, refresh);
      });

      // 放在 Vite 的资源中间件之后，既不拦截源码/HMR，也不需要另起服务器。
      return () => {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url || !['GET', 'HEAD'].includes(request.method ?? '')) return next();
          try {
            const url = new URL(request.url, 'http://localhost');
            let path = decodeURIComponent(url.pathname).slice(1);
            if (!path || path.endsWith('/')) path += 'index.html';
            if (documents.has(path + '/index.html')) {
              response.statusCode = 308;
              response.setHeader('Location', url.pathname + '/' + url.search);
              response.end();
              return;
            }

            const found = documents.get(path);
            const html = path.endsWith('.html') || found === undefined;
            const document = found ?? documents.get('404.html')!;
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

export default defineConfig({
  root,
  input: 'src/main.ts',
  appType: 'custom',
  plugins: [articlePages()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: join(root, 'dist'),
    emptyOutDir: true,
    manifest: true,
    modulePreload: false,
  },
});
