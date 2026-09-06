import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { NetworkKernel } from '../src/kernel/network.js';
import { createHttp } from '../src/runtime/http-core.js';
import { createHttpClient } from '../src/runtime/http-client.js';

function realm() {
  let sequence = 0;
  const listeners = new Map<number, (event: string, args: any[]) => void>();
  const commands: string[] = [];
  const emit = (handle: number, event: string, ...args: any[]) =>
    listeners.get(handle)?.(event, args);
  const allocate = () => ++sequence;
  const network = new NetworkKernel(emit, allocate);

  const subscribe = (handle: number, listener: (event: string, args: any[]) => void) => {
    listeners.set(handle, listener);
    return () => {
      listeners.delete(handle);
    };
  };
  const call = async (operation: string, ...args: any[]) => {
    commands.push(operation);
    return network.execute(operation, args);
  };
  return {
    client: createHttpClient(call, subscribe),
    http: createHttp(call, subscribe),
    commands,
    close: () => network.close(),
  };
}

test(
  'HTTP client streams a chunked POST and parses response/trailers locally',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = http
      .createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (data) => chunks.push(data));
        req.on('end', () => {
          res.setHeader('Trailer', 'x-finished');
          res.write(Buffer.concat(chunks));
          res.addTrailers({ 'x-finished': 'yes' });
          res.end();
        });
      })
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const req = runtime.client.request(
        `http://127.0.0.1:${(server.address() as any).port}/echo`,
        { method: 'POST' },
      );
      const response = once(req, 'response');
      req.write('hello — ');
      req.write('');
      req.end('sample');
      const [res] = await response;
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      await once(res, 'end');
      assert.equal(text, 'hello — sample');
      assert.equal(res.statusCode, 200);
      assert.equal(res.trailers['x-finished'], 'yes');
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  'HTTP request end/close and response finish/close preserve stream ordering',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const events: string[] = [];
    const server = runtime.http.createServer((req: any, res: any) => {
      req.on('data', (data: Buffer) => events.push(data.toString()));
      req.on('end', () => {
        events.push('end');
        res.end('response');
      });
      req.on('close', () => events.push('request-close'));
      res.on('finish', () => events.push('finish'));
      res.on('close', () => events.push('response-close'));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const request = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        method: 'POST',
        agent: false,
      });
      const response = once(request, 'response');
      request.end('body');
      const [incoming] = await response;
      incoming.resume();
      await once(incoming, 'end');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(events.filter((event) => event === 'finish').length, 1);
      assert.ok(events.indexOf('body') < events.indexOf('end'));
      assert.ok(events.indexOf('end') < events.indexOf('request-close'));
      assert.ok(events.indexOf('finish') < events.indexOf('response-close'));
    } finally {
      await runtime.close();
    }
  },
);

test(
  'HTTP upgrade hands over a duplex socket and preserves bytes after headers',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = runtime.http.createServer();
    server.on('upgrade', (_req: any, socket: any, head: Buffer) => {
      assert.equal(head.length, 0);
      socket.cork();
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n',
      );
      socket.write('welcome');
      socket.uncork();
      socket.on('data', (data: Buffer) => socket.write(data));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const req = runtime.client.request({
        host: '127.0.0.1',
        port: server.address().port,
        headers: { Connection: 'Upgrade', Upgrade: 'test' },
      });
      const upgraded = once(req, 'upgrade');
      req.end();
      const [res, socket, head] = await upgraded;
      assert.equal(res.statusCode, 101);
      assert.equal(head.toString(), 'welcome');
      const echoed = once(socket, 'data');
      socket.write(Buffer.from([0, 128, 255]));
      assert.deepEqual(Buffer.from((await echoed)[0]), Buffer.from([0, 128, 255]));
      socket.destroy();
      // Header + welcome were corked into one network command, not one command per write.
      assert.equal(runtime.commands.filter((name) => name === 'net.write').length, 4);
    } finally {
      await runtime.close();
    }
  },
);

test(
  'HTTP request timeout configured before the socket handle arrives is delivered',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = http.createServer(() => {}).listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const request = runtime.client.request(
        `http://127.0.0.1:${(server.address() as any).port}/`,
        { timeout: 30 },
      );
      const timedOut = once(request, 'timeout');
      request.end();
      await timedOut;
      const closed = once(request, 'close');
      request.destroy();
      await closed;
    } finally {
      await runtime.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
