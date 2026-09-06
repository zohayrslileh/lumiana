import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { init, parse } from 'es-module-lexer';
import { lumiana } from '../dist/vite.js';

test(
  'dependency optimization preserves CommonJS require export conditions',
  { timeout: 15_000 },
  async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'node_modules/.lumiana-conditions-'));
    const consumer = path.join(root, 'node_modules/contract-consumer');
    const dependency = path.join(root, 'node_modules/contract-mode');
    await fs.mkdir(consumer, { recursive: true });
    await fs.mkdir(dependency, { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await fs.writeFile(
      path.join(root, 'index.html'),
      '<script type="module" src="/main.js"></script>',
    );
    await fs.writeFile(
      path.join(root, 'main.js'),
      "import result from 'contract-consumer';console.log(result);",
    );
    await fs.writeFile(
      path.join(consumer, 'package.json'),
      '{"name":"contract-consumer","main":"index.cjs"}',
    );
    await fs.writeFile(
      path.join(consumer, 'index.cjs'),
      "const path=require('node:path');module.exports=require('contract-mode')(path.sep);",
    );
    await fs.writeFile(
      path.join(dependency, 'package.json'),
      JSON.stringify({
        name: 'contract-mode',
        exports: { import: './import.mjs', require: './require.cjs' },
      }),
    );
    await fs.writeFile(
      path.join(dependency, 'import.mjs'),
      "export default ()=>'wrong-import-mode';",
    );
    await fs.writeFile(
      path.join(dependency, 'require.cjs'),
      "module.exports=()=> 'correct-require-mode';",
    );
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [lumiana()],
      optimizeDeps: { include: ['contract-consumer'] },
      server: { host: '127.0.0.1', port: 0 },
    });
    try {
      await server.listen();
      const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
      const main = await (await fetch(origin + '/main.js')).text();
      await init;
      const specifier = parse(main)[0].find((item) => item.n?.includes('contract-consumer'))!.n!;
      const response = await fetch(origin + specifier);
      assert.equal(response.status, 200);
      const code = await response.text();
      assert.ok(code.includes('correct-require-mode'));
      assert.ok(!code.includes('wrong-import-mode'));
    } finally {
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

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
        "import {fileURLToPath} from 'node:url'; export const filename=fileURLToPath(import.meta.url); export const read = value => value.nested.value; export const env = () => JSON.stringify(process.env);",
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
          for (const name of ['browser.js', 'runtime/fs.js', 'runtime/filesystem.js']) {
            const response = await request(runtime(name));
            const code = await response.text();
            await init;
            for (const dependency of parse(code)[0]) {
              if (!dependency.n?.startsWith('/@fs/') || !dependency.n.includes('/node_modules/'))
                continue;
              const imported = await request(origin + dependency.n);
              assert.equal(imported.status, 200, dependency.n);
              const source = await imported.text();
              assert.ok(
                parse(source)[1].length > 0,
                `Dependency served without ESM exports: ${dependency.n}`,
              );
            }
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
          const mainCode = await main.text();
          assert.doesNotMatch(mainCode, /readPath/);
          assert.match(mainCode, /runtime\/process\.js/);
          assert.match(mainCode, /runtime\/url\.js/);
          assert.ok(
            mainCode.includes(JSON.stringify(pathToFileURL(path.join(root, 'main.js')).href)),
          );
          for (const [, dependency] of mainCode.matchAll(/from ["'](\/\@fs\/[^"']+)["']/g)) {
            const runtimeDependency = await request(origin + dependency);
            assert.equal(runtimeDependency.status, 200, dependency);
            await runtimeDependency.text();
          }
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
