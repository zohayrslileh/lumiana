import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import { WebSocket } from 'ws';
import { lumiana } from '../dist/vite.js';
import { encodePacket, decodePacket } from '../src/protocol.js';
import { decodeValue } from '../src/values.js';

test(
  'Vite preview serves the local runtime with the configured base and credentials',
  { timeout: 20_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'node_modules/.lumiana-preview-'));
    const credentials = { username: 'preview-user', password: 'preview-password' };
    const previous = [process.env.LUMIANA_USERNAME, process.env.LUMIANA_PASSWORD];
    t.after(() => {
      for (const [i, key] of ['LUMIANA_USERNAME', 'LUMIANA_PASSWORD'].entries()) {
        if (previous[i] === undefined) delete process.env[key];
        else process.env[key] = previous[i];
      }
    });
    try {
      await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await fs.writeFile(
        path.join(root, 'index.html'),
        '<script type="module" src="/main.js"></script>',
      );
      await fs.writeFile(
        path.join(root, 'main.js'),
        'import { Buffer } from "node:buffer"; document.body.textContent = Buffer.from(import.meta.env.MODE === "production" ? "built-preview" : "wrong-mode").toString();',
      );
      for (const [base, outDir] of [
        ['/', 'dist'],
        ['/app/', 'custom-output'],
      ]) {
        const activeCredentials =
          base === '/' ? credentials : { username: 'env-user', password: 'env-password' };
        if (base === '/') {
          delete process.env.LUMIANA_USERNAME;
          delete process.env.LUMIANA_PASSWORD;
        } else {
          process.env.LUMIANA_USERNAME = activeCredentials.username;
          process.env.LUMIANA_PASSWORD = activeCredentials.password;
        }
        const config = () => ({
          root,
          base,
          configFile: false as const,
          logLevel: 'silent' as const,
          plugins: [lumiana({ defaultCredentials: credentials })],
          build: { outDir, modulePreload: false },
        });
        await build(config());
        const server = await preview({ ...config(), preview: { host: '127.0.0.1', port: 0 } });
        let socket: WebSocket | undefined;
        try {
          const address = server.httpServer.address() as { port: number };
          const origin = `http://127.0.0.1:${address.port}`;
          const html = await (await fetch(origin + base)).text();
          const asset = html.match(/src="([^"]+\.js)"/)?.[1];
          assert.ok(asset, html);
          assert.match(await (await fetch(new URL(asset, origin))).text(), /built-preview/);
          const previousDocument = globalThis.document;
          const document = { body: { textContent: '' } };
          Object.assign(globalThis, { document });
          try {
            await import(
              pathToFileURL(path.join(root, outDir!, 'client', asset.slice(base!.length))).href
            );
            assert.equal(document.body.textContent, 'built-preview');
          } finally {
            if (previousDocument === undefined) delete (globalThis as any).document;
            else globalThis.document = previousDocument;
          }
          const endpoint = origin + base + '__lumiana/';
          const establish = (password: string) =>
            fetch(endpoint + 'connect', {
              method: 'POST',
              body: encodePacket({ ...activeCredentials, password }) as Uint8Array<ArrayBuffer>,
            });
          assert.equal((await establish('wrong')).status, 401);
          const response = await establish(activeCredentials.password);
          assert.equal(response.status, 200);
          const { id, status } = decodePacket(new Uint8Array(await response.arrayBuffer()));
          assert.equal(status.mode, 'production');
          socket = new WebSocket(endpoint.replace('http:', 'ws:') + 'ws?id=' + id);
          const [ready] = await once(socket, 'message');
          assert.equal(decodePacket(new Uint8Array(ready)).type, 'ready');
          const received = once(socket, 'message');
          socket.send(encodePacket({ type: 'status', id: 1 }));
          const [data] = await received;
          assert.equal(decodeValue(decodePacket(new Uint8Array(data)).value).pid, process.pid);

          const closed = once(socket, 'close');
          await server.close();
          await closed;
        } finally {
          socket?.terminate();
          await server.close();
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
