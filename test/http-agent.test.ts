import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createAgent } from '../src/runtime/http-agent.js';
import { createHttpClient } from '../src/runtime/http-client.js';

const Agent = createAgent((options: any) => net.connect(options));
const client = createHttpClient(
  async () => {
    throw new Error('Pool operations must stay local');
  },
  () => () => {},
  { protocol: 'http:', defaultPort: 80, createConnection: (options: any) => net.connect(options) },
);
async function fetch(port: number, agent: any, path = '/') {
  const request = client.get({ host: '127.0.0.1', port, agent, path });
  const [response] = await once(request, 'response');
  let body = '';
  response.on('data', (bytes: Buffer) => (body += bytes));
  await once(response, 'end');
  return { body, request, socket: response.socket };
}

test(
  'Agent reuses a socket after the response is consumed and keeps all scheduling local',
  { timeout: 5000 },
  async () => {
    let connections = 0;
    const server = http.createServer((req, res) => res.end(req.url)).listen(0, '127.0.0.1');
    server.on('connection', () => connections++);
    await once(server, 'listening');
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const first = await fetch((server.address() as any).port, agent, '/first');
      const second = await fetch((server.address() as any).port, agent, '/second');
      assert.equal(first.body, '/first');
      assert.equal(second.body, '/second');
      assert.equal(first.socket, second.socket);
      assert.equal(second.request.reusedSocket, true);
      assert.equal(connections, 1);
      assert.equal(Object.values(agent.freeSockets).flat().length, 1);
    } finally {
      agent.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test('Agent limits concurrent sockets and drains queued requests', { timeout: 5000 }, async () => {
  let active = 0,
    maximum = 0,
    connections = 0;
  const server = http
    .createServer((req, res) => {
      active++;
      maximum = Math.max(maximum, active);
      setTimeout(() => {
        active--;
        res.end(req.url);
      }, 15);
    })
    .listen(0, '127.0.0.1');
  server.on('connection', () => connections++);
  await once(server, 'listening');
  const agent = new Agent({ keepAlive: true, maxSockets: 2, maxTotalSockets: 2 });
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        fetch((server.address() as any).port, agent, '/' + index),
      ),
    );
    assert.deepEqual(
      results.map((result) => result.body),
      Array.from({ length: 8 }, (_, index) => '/' + index),
    );
    assert.equal(maximum, 2);
    assert.equal(connections, 2);
    assert.equal(Object.keys(agent.requests).length, 0);
  } finally {
    agent.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test(
  'custom Agent connection factory may deliver its socket asynchronously',
  { timeout: 5000 },
  async () => {
    const server = http.createServer((_req, res) => res.end('custom')).listen(0, '127.0.0.1');
    await once(server, 'listening');
    let created = 0;
    class CustomAgent extends Agent {
      createConnection(options: any, callback: any) {
        created++;
        setTimeout(() => callback(null, net.connect(options)), 5);
      }
    }
    const agent = new CustomAgent({ keepAlive: true });
    try {
      assert.equal((await fetch((server.address() as any).port, agent)).body, 'custom');
      assert.equal((await fetch((server.address() as any).port, agent)).body, 'custom');
      assert.equal(created, 1);
    } finally {
      agent.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test('Agent never reuses a response with Connection: close', { timeout: 5000 }, async () => {
  const server = http
    .createServer((_req, res) => {
      res.setHeader('Connection', 'close');
      res.end('close');
    })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const agent = new Agent({ keepAlive: true });
  try {
    const first = await fetch((server.address() as any).port, agent);
    const second = await fetch((server.address() as any).port, agent);
    assert.notEqual(first.socket, second.socket);
    assert.equal(second.request.reusedSocket, false);
  } finally {
    agent.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test(
  'maxTotalSockets evicts an idle socket when a different origin is queued',
  { timeout: 5000 },
  async () => {
    const first = http.createServer((_req, res) => res.end('first')).listen(0, '127.0.0.1');
    const second = http.createServer((_req, res) => res.end('second')).listen(0, '127.0.0.1');
    await Promise.all([once(first, 'listening'), once(second, 'listening')]);
    const agent = new Agent({ keepAlive: true, maxTotalSockets: 1 });
    try {
      assert.equal((await fetch((first.address() as any).port, agent)).body, 'first');
      assert.equal((await fetch((second.address() as any).port, agent)).body, 'second');
    } finally {
      agent.destroy();
      first.closeAllConnections();
      second.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => first.close(() => resolve())),
        new Promise<void>((resolve) => second.close(() => resolve())),
      ]);
    }
  },
);
