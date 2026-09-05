import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { lumiana } from '../../dist/vite.js';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [lumiana()],
});
