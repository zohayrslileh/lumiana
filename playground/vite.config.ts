import { defineConfig } from 'vite';
import { lumiana } from '../dist/vite.js';

export default defineConfig({
  plugins: [lumiana()],
});
