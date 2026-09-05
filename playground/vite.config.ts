import { defineConfig } from 'vite';
import { lumiana } from '../dist/index.js';

export default defineConfig({
  plugins: [lumiana()],
});
