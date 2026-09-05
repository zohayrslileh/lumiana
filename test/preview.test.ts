import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { build, preview } from 'vite';
import { WebSocket } from 'ws';
import { lumiana } from '../dist/index.js';
import { encodePacket, decodePacket } from '../src/protocol.js';

test(
  'Vite preview serves the build and native handlers with the configured base and credentials',
  { timeout: 20_000 },
  async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'node_modules/.lumiana-preview-'));
    const credentials = { username: 'preview-user', password: 'preview-password' };
    try {
      await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await fs.writeFile(
        path.join(root, 'handler.cjs'),
        'module.exports = () => "native-preview";',
      );
      await fs.writeFile(
        path.join(root, 'index.html'),
        '<script type="module" src="/main.js"></script>',
      );
      await fs.writeFile(
        path.join(root, 'main.js'),
        'document.body.textContent = "built-preview";',
      );
      for (const [base, outDir] of [
        ['/', 'dist'],
        ['/app/', 'custom-output'],
      ]) {
        const config = () => ({
          root,
          base,
          configFile: false as const,
          logLevel: 'silent' as const,
          plugins: [lumiana({ defaultCredentials: credentials })],
          build: { outDir },
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
          const endpoint = origin + base + '__lumiana/';
          const establish = (password: string) =>
            fetch(endpoint + 'connect', {
              method: 'POST',
              body: encodePacket({ ...credentials, password }) as Uint8Array<ArrayBuffer>,
            });
          assert.equal((await establish('wrong')).status, 401);
          const response = await establish(credentials.password);
          assert.equal(response.status, 200);
          const { id, status } = decodePacket(new Uint8Array(await response.arrayBuffer()));
          assert.equal(status.mode, 'production');
          socket = new WebSocket(endpoint.replace('http:', 'ws:') + 'ws?id=' + id);
          const [ready] = await once(socket, 'message');
          assert.equal(decodePacket(new Uint8Array(ready)).type, 'ready');
          const received = once(socket, 'message');
          socket.send(encodePacket({ type: 'status', id: 1 }));
          const [data] = await received;
          assert.equal(decodePacket(new Uint8Array(data)).value.pid, process.pid);

          let sequence = 1;
          const invoke = async (operation: string, args: any[]) => {
            const response = await fetch(endpoint + 'sync', {
              method: 'POST',
              headers: { 'X-Lumiana-Session': id, 'Content-Type': 'application/msgpack' },
              body: encodePacket({
                type: 'invoke',
                id: ++sequence,
                sync: true,
                invocation: { operation, args },
              }) as Uint8Array<ArrayBuffer>,
            });
            assert.equal(response.status, 200);
            const packet = decodePacket(Buffer.from(await response.text(), 'base64'));
            assert.equal(packet.ok, true, packet.error?.message);
            return packet.value;
          };
          const atom = (value: any) => ({ root: value, nodes: [] });
          const handler = await invoke('module', [atom('./handler.cjs')]);
          const reference = {
            root: { index: 0 },
            nodes: [{ kind: 'return', id: handler.nodes[0].ref.id }],
          };
          assert.equal((await invoke('apply', [reference, atom(null)])).root, 'native-preview');

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
