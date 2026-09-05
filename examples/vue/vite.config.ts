import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { lumiana } from 'lumiana/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), lumiana()],
});
