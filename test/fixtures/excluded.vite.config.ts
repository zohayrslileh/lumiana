import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { lumiana } from '../../dist/index.js';
export default defineConfig({
  root: fileURLToPath(new URL('../../example/', import.meta.url)),
  plugins: [lumiana({ nodeModules: ['chokidar'] })],
});
