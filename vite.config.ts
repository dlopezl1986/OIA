import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  envDir: '..',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
