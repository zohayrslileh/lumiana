import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    worker: 'src/worker.ts',
  },
  format: ['esm'],
  splitting: false,
  dts: true,
  clean: true,
  target: 'node20',
  external: ['vite'],
  noExternal: ['@msgpack/msgpack'],
});
