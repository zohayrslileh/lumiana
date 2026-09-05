import { defineConfig } from 'tsup';
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    access: 'src/access.ts',
    host: 'src/host.ts',
    worker: 'src/worker.ts',
    'runtime/fs-promises': 'src/runtime/fs-promises.ts',
    'runtime/http': 'src/runtime/http.ts',
    'runtime/net': 'src/runtime/net.ts',
  },
  format: ['esm'],
  splitting: false,
  dts: true,
  clean: true,
  target: 'node20',
  external: ['vite', 'esbuild', 'ws'],
  noExternal: ['@msgpack/msgpack', 'import-meta-resolve'],
});
