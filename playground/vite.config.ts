import { defineConfig } from 'vite';
import lumiana from '../dist/index.js';

export default defineConfig({
  plugins: [
    lumiana({
      configureBackend(server) {
        // Test custom route extension (demonstrating clean extensibility)
        server.get('/api/__lumiana/info', (_req, res) => {
          res.status(200).json({
            app: 'Lumiana Playground',
            status: 'running',
            extensible: true,
          });
        });
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
