import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { lumiana } from '../dist/index.js';

test(
  'dev serves linked browser runtime files while preserving filesystem restrictions',
  { timeout: 15_000 },
  async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'node_modules/.lumiana-dev-'));
    try {
      await fs.writeFile(path.join(root, 'package.json'), '{"name":"dev-fixture","type":"module"}');
      await fs.writeFile(
        path.join(root, 'index.html'),
        '<script type="module" src="/main.js"></script>',
      );
      await fs.writeFile(
        path.join(root, 'main.js'),
        'export const read = value => value.nested.value; export const env = () => JSON.stringify(process.env);',
      );
      for (const allow of [undefined, [root]]) {
        const server = await createServer({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [lumiana()],
          server: { host: '127.0.0.1', port: 0, fs: { strict: true, ...(allow ? { allow } : {}) } },
        });
        try {
          await server.listen();
          const address = server.httpServer!.address() as { port: number };
          const origin = `http://127.0.0.1:${address.port}`;
          const request = (url: string) => fetch(url, { signal: AbortSignal.timeout(5000) });
          const runtime = (name: string) =>
            origin + '/@fs/' + path.resolve('dist', name).replaceAll('\\', '/');
          // Optimized dependencies can request these before the application import graph loads.
          for (const name of ['access.js', 'client.js']) {
            const response = await request(runtime(name));
            const code = await response.text();
            for (const [, dependency] of code.matchAll(/from ["'](\/node_modules\/[^"']+)["']/g)) {
              const bundled = await request(origin + dependency);
              assert.equal(bundled.status, 200, dependency);
              await bundled.text();
            }
            assert.equal(response.status, 200, name);
            assert.match(response.headers.get('content-type')!, /javascript/);
          }
          assert.equal((await request(runtime('host.js'))).status, 403);
          const main = await request(origin + '/main.js');
          assert.equal(main.status, 200);
          assert.match(await main.text(), /readPath/);
          assert.ok(server.config.server.fs.allow.includes(root));
          assert.equal(server.config.server.fs.strict, true);
        } finally {
          await server.waitForRequestsIdle();
          await server.close();
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
