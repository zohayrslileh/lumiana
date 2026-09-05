import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { staticHandler } from '../dist/host.js';
test('static files cannot escape the client root, including encoded paths and symlinks', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-static-'));
  const clientDir = path.join(temp, 'client');
  await fs.mkdir(clientDir);
  await fs.writeFile(path.join(clientDir, 'index.html'), 'client');
  await fs.writeFile(path.join(temp, 'secret.txt'), 'private');
  await fs.symlink(path.join(temp, 'secret.txt'), path.join(clientDir, 'link.txt'));
  const handle = staticHandler(clientDir);
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  async function get(url: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: (server.address() as any).port, path: url },
        (res) => {
          let body = '';
          res.on('data', (b) => {
            body += b;
          });
          res.on('end', () => resolve({ status: res.statusCode!, body }));
        },
      );
      req.on('error', reject);
    });
  }
  try {
    assert.equal((await get('/')).body, 'client');
    for (const url of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/link.txt',
      '/.env',
      '/%5c..%5csecret.txt',
    ])
      assert.equal((await get(url)).status, 403, url);
    assert.equal((await get('/route')).body, 'client');
    assert.equal((await get('/missing.js')).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(temp, { recursive: true });
  }
});

test('connections own distinct workers, accept fragmented binary frames, and end together', async () => {
  const { attachHost } = await import('../dist/host.js');
  const { encodePacket, decodePacket } = await import('../src/protocol.js');
  const { encodeValue, decodeValue } = await import('../src/values.js');
  const { WebSocket } = await import('ws');
  const server = http.createServer((req, res) => void host.handle(req, res));
  const host = attachHost(server, { root: process.cwd(), username: 'test', password: 'secret' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const sessions: any[] = [];
  async function session() {
    const response = await fetch(base + '/__lumiana/connect', {
      method: 'POST',
      body: encodePacket({ username: 'test', password: 'secret' }) as any,
    });
    const { id } = decodePacket(new Uint8Array(await response.arrayBuffer()));
    const socket = new WebSocket(base.replace('http', 'ws') + '/__lumiana/ws?id=' + id);
    await once(socket, 'message');
    let sequence = 0;
    const pending = new Map<number, (p: any) => void>();
    socket.on('message', (data) => {
      const packet = decodePacket(new Uint8Array(data as Buffer));
      pending.get(packet.id)?.(packet);
      pending.delete(packet.id);
    });
    const s = {
      id,
      socket,
      request(operation: string, args: any[], fragment = false): Promise<any> {
        const id = ++sequence;
        return new Promise((resolve) => {
          pending.set(id, resolve);
          const bytes = encodePacket({
            type: 'invoke',
            id,
            invocation: { operation, args: args.map(encodeValue) },
          });
          if (fragment) {
            socket.send(bytes.subarray(0, 3), { fin: false });
            socket.send(bytes.subarray(3), { fin: true });
          } else socket.send(bytes);
        });
      },
    };
    sessions.push(s);
    return s;
  }
  try {
    const a = await session(),
      b = await session();
    const thread = async (s: any) =>
      decodeValue((await s.request('kernelSync', ['system.threadId'], true)).value);
    const [first, second] = await Promise.all([thread(a), thread(b)]);
    assert.notEqual(first, second);
    const replies = await Promise.all(
      Array.from({ length: 30 }, () => a.request('kernelSync', ['os.platform'])),
    );
    assert.ok(replies.every((p) => p.ok));
    const duplicate = new WebSocket(base.replace('http', 'ws') + '/__lumiana/ws?id=' + a.id);
    const [error] = await once(duplicate, 'error');
    assert.match(error.message, /409/);
    const closed = once(a.socket, 'close');
    a.socket.close();
    await closed;
    assert.equal(await thread(b), second);
    const ended = once(b.socket, 'close');
    await host.close();
    await ended;
  } finally {
    for (const s of sessions) s.socket.terminate();
    await host.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
