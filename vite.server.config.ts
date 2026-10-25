import { defineConfig } from 'vite';

// Empaqueta el servidor Node (desarrollo local o ejecución en tu propio equipo).
export default defineConfig({
  build: { ssr: 'server/entries/node.ts', outDir: 'dist-server', emptyOutDir: true, target: 'node22', minify: false },
  ssr: { noExternal: true },
});
