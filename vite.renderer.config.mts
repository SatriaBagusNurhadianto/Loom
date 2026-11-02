import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({
  root: 'src/renderer',
  plugins: [solid()],
  server: { port: 5173, strictPort: true },
});
