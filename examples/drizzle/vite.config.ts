import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { lumiana } from 'lumiana/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), lumiana()],
});
