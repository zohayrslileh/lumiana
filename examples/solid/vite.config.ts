import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { lumiana } from 'lumiana/vite';

export default defineConfig({
  plugins: [solid(), lumiana()],
});
