import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@opencode-ai/sdk'] },
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), service: resolve('src/services/index.ts') },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'service' ? 'service.cjs' : '[name].js'),
          format: 'cjs',
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { input: resolve('src/preload/index.ts'), output: { format: 'cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [solid()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
