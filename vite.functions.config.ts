import { defineConfig } from 'vite';

// Empaqueta el servidor para Firebase Cloud Functions en functions/lib/index.js.
export default defineConfig({
  build: {
    ssr: 'server/entries/functions.ts',
    outDir: 'functions/lib',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: { external: [/^firebase-functions/, /^firebase-admin/], output: { entryFileNames: 'index.js' } },
  },
  ssr: { noExternal: true, external: ['firebase-functions', 'firebase-admin'] },
});
