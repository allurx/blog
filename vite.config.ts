import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { articlePages } from './src/build/dev-plugin.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  input: 'src/client/main.ts',
  appType: 'custom',
  plugins: [articlePages(root)],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    modulePreload: false,
  },
});
