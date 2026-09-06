import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import tls from 'node:tls';
import https from 'node:https';
import { NetworkKernel } from '../src/kernel/network.js';
import { createNetwork } from '../src/runtime/network.js';
import { createTls } from '../src/runtime/tls-core.js';
import { createHttp } from '../src/runtime/http-core.js';
import { createHttpClient } from '../src/runtime/http-client.js';
import { encodeValue, decodeValue } from '../src/values.js';
import { key, cert } from '../examples/compatibility/src/fixtures/tls.js';

function realm() {
  let sequence = 0;
  const listeners = new Map<number, (event: string, args: any[]) => void>();
  const copy = (value: any) => decodeValue(encodeValue(value));
  const emit = (handle: number, event: string, ...args: any[]) =>
    listeners.get(handle)?.(event, copy(args));
  const allocate = () => ++sequence;
  const kernel = new NetworkKernel(emit, allocate);

  const commands: string[] = [];
  const call = async (operation: string, ...args: any[]) => {
    commands.push(operation);
    return copy(await kernel.execute(operation, copy(args)));
  };
  const sync = (operation: string, ...args: any[]) => {
    commands.push(operation);
    return copy(kernel.executeSync(operation, copy(args)));
  };
  const subscribe = (handle: number, listener: (event: string, args: any[]) => void) => {
    listeners.set(handle, listener);
    return () => {
      listeners.delete(handle);
    };
  };
  const network = createNetwork(call, subscribe);
  const secure = createTls(call, subscribe, sync, network);
  const client = createHttpClient(call, subscribe);
  return {
    ClientRequest: client.ClientRequest,
    network,
    tls: secure,
    commands,
    client: client.withTransport({
      protocol: 'https:',
      defaultPort: 443,
      createConnection: secure.connect,
    }),
    server: createHttp(call, subscribe, secure),
    close: () => kernel.close(),
  };
}

async function body(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  await once(stream, 'end');
  return Buffer.concat(chunks);
}

test(
  'TLS client verifies certificates, negotiates ALPN and sends queued binary writes',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = tls
      .createServer({ key, cert, ALPNProtocols: ['echo'] }, (socket) => socket.pipe(socket))
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const socket = runtime.tls.connect({
        host: '127.0.0.1',
        port: (server.address() as any).port,
        ca: cert,
        ALPNProtocols: ['echo'],
      });
      assert.ok(socket instanceof runtime.network.Socket);
      const connected = once(socket, 'secureConnect');
      const bytes = Buffer.from([0, 127, 128, 255]);
      const received = body(socket);
      socket.end(bytes);
      await connected;
      assert.equal(socket.authorized, true);
      assert.equal(socket.alpnProtocol, 'echo');
      assert.match(socket.getProtocol(), /^TLSv1\.[23]$/);
      assert.equal(socket.getPeerCertificate().subject.CN, 'localhost');
      const count = runtime.commands.length;
      socket.getPeerCertificate(true);
      socket.getCipher();
      socket.getProtocol();
      assert.equal(runtime.commands.length, count);
      assert.deepEqual(await received, bytes);
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  'TLS server exposes a local TLSSocket and interoperates with native Node',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = runtime.tls.createServer({ key, cert }, (socket: any) => {
      assert.ok(socket instanceof runtime.tls.TLSSocket);
      assert.ok(socket instanceof runtime.network.Socket);
      assert.equal(socket.encrypted, true);
      socket.pipe(socket);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const socket = tls.connect({ host: '127.0.0.1', port: server.address().port, ca: cert });
      const received = body(socket);
      socket.end('TLS — sample 🌍');
      assert.equal((await received).toString(), 'TLS — sample 🌍');
    } finally {
      await runtime.close();
    }
  },
);

test(
  'TLS rejects untrusted and mismatched certificates without sending queued application data',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    let bytes = 0;
    const server = tls
      .createServer({ key, cert }, (socket) =>
        socket.on('data', (chunk) => (bytes += chunk.length)),
      )
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      for (const [options, code] of [
        [{}, 'DEPTH_ZERO_SELF_SIGNED_CERT'],
        [{ ca: cert, servername: 'wrong.example' }, 'ERR_TLS_CERT_ALTNAME_INVALID'],
        [
          {
            ca: cert,
            checkServerIdentity: () =>
              Object.assign(new Error('Custom identity rejected'), { code: 'CUSTOM_IDENTITY' }),
          },
          'CUSTOM_IDENTITY',
        ],
      ] as const) {
        const socket = runtime.tls.connect({
          host: '127.0.0.1',
          port: (server.address() as any).port,
          ...options,
        });
        const failure = once(socket, 'error');
        const closed = new Promise<void>((resolve) => socket.once('close', resolve));
        socket.write('must remain queued');
        assert.equal((await failure)[0].code, code);
        await closed;
      }
      assert.equal(bytes, 0);
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  'HTTPS reuses HTTP framing over verified TLS, including chunked bodies and trailers',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = https
      .createServer({ key, cert }, async (req, res) => {
        assert.equal((req.socket as tls.TLSSocket).servername, 'localhost');
        const bytes = await body(req);
        res.setHeader('Trailer', 'x-complete');
        res.write(bytes);
        res.addTrailers({ 'x-complete': 'yes' });
        res.end();
      })
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const req = runtime.client.request(
        `https://localhost:${(server.address() as any).port}/echo`,
        { ca: cert, method: 'POST', family: 4 },
      );
      assert.ok(req instanceof runtime.ClientRequest);
      const response = once(req, 'response');
      req.write(Buffer.from([0, 128, 255]));
      req.end(' — sample');
      const [res] = await response;
      assert.ok(res.socket instanceof runtime.tls.TLSSocket);
      assert.deepEqual(
        await body(res),
        Buffer.concat([Buffer.from([0, 128, 255]), Buffer.from(' — sample')]),
      );
      assert.equal(res.trailers['x-complete'], 'yes');
    } finally {
      await runtime.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  'HTTPS server streams a native request and hands a TLS socket to upgrades',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = runtime.server.createServer({ key, cert }, (req: any, res: any) => {
      assert.equal(req.socket.encrypted, true);
      req.pipe(res);
    });
    server.on('upgrade', (_req: any, socket: any, head: Buffer) => {
      assert.ok(socket instanceof runtime.tls.TLSSocket);
      assert.equal(head.length, 0);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n',
      );
      socket.pipe(socket);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const req = https.request({
        host: '127.0.0.1',
        port: server.address().port,
        ca: cert,
        method: 'POST',
      });
      const response = once(req, 'response');
      req.end('HTTPS body');
      assert.equal((await body((await response)[0])).toString(), 'HTTPS body');
      const upgrade = runtime.client.get({
        host: '127.0.0.1',
        port: server.address().port,
        ca: cert,
        headers: { Connection: 'Upgrade', Upgrade: 'echo' },
      });
      const [, socket] = await once(upgrade, 'upgrade');
      const echoed = once(socket, 'data');
      socket.write(Buffer.from([0, 255, 128]));
      assert.deepEqual(Buffer.from((await echoed)[0]), Buffer.from([0, 255, 128]));
      socket.destroy();
    } finally {
      await runtime.close();
    }
  },
);

test(
  'TLS secure contexts keep native state behind a handle and custom checks run locally',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = tls
      .createServer({ key, cert }, (socket) => socket.end('verified'))
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const context = runtime.tls.createSecureContext({ ca: cert });
      let checks = 0;
      const socket = runtime.tls.connect({
        host: '127.0.0.1',
        port: (server.address() as any).port,
        secureContext: context,
        checkServerIdentity(host: string, certificate: any) {
          checks++;
          assert.equal(host, '127.0.0.1');
          assert.equal(certificate.subject.CN, 'localhost');
          return runtime.tls.checkServerIdentity(host, certificate);
        },
      });
      assert.equal((await body(socket)).toString(), 'verified');
      assert.equal(checks, 1);
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  'TLS can wrap an existing TCP connection without opening another socket',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    let connections = 0;
    const server = tls
      .createServer({ key, cert }, (socket) => socket.pipe(socket))
      .listen(0, '127.0.0.1');
    server.on('connection', () => connections++);
    await once(server, 'listening');
    try {
      const tcp = runtime.network.connect({
        host: '127.0.0.1',
        port: (server.address() as any).port,
      });
      await once(tcp, 'connect');
      const socket = runtime.tls.connect({ socket: tcp, ca: cert, servername: 'localhost' });
      const received = body(socket);
      socket.end('wrapped');
      assert.equal((await received).toString(), 'wrapped');
      assert.equal(connections, 1);
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  'TLS setup failure emits one error and close even before a native handle exists',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    try {
      const socket = runtime.tls.connect({ port: 1, ciphers: 'not-a-cipher' });
      const events: string[] = [];
      socket.on('error', () => events.push('error'));
      const closed = new Promise<void>((resolve) =>
        socket.on('close', (hadError: boolean) => {
          assert.equal(hadError, true);
          events.push('close');
          resolve();
        }),
      );
      socket.end('queued');
      await closed;
      assert.deepEqual(events, ['error', 'close']);
    } finally {
      await runtime.close();
    }
  },
);

test(
  'Worker shutdown closes sockets still waiting for a TLS handshake',
  { timeout: 5000 },
  async () => {
    const runtime = realm();
    const server = runtime.tls.createServer({ key, cert });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const net = await import('node:net');
    const socket = net.connect({ host: '127.0.0.1', port: server.address().port });
    await once(socket, 'connect');
    const closed = once(socket, 'close');
    try {
      await runtime.close();
      await closed;
    } finally {
      socket.destroy();
    }
  },
);
