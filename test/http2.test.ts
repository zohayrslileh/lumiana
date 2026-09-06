import test from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { createHttp2 } from '../src/runtime/http2-core.js';
import { getPackedSettings, getUnpackedSettings } from '../src/runtime/http2-codec.js';
import { key, cert } from '../examples/compatibility/src/fixtures/tls.js';

// The entire protocol runs over an ordinary Duplex: no engine calls are available here.
const local = createHttp2(net, tls);
async function body(stream: any) {
  const bytes: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => bytes.push(Buffer.from(chunk)));
  await once(stream, 'end');
  return Buffer.concat(bytes);
}
async function closeServer(server: any) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test(
  'local HTTP/2 multiplexes large binary streams with a native peer and acknowledges settings and ping',
  { timeout: 8000 },
  async () => {
    const server = http2.createServer();
    server.on('stream', (stream, headers) => {
      stream.respond({ ':status': 200, 'x-path': headers[':path'] });
      stream.pipe(stream);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const session = local.connect(`http://127.0.0.1:${(server.address() as any).port}`);
    session.on('error', (error: Error) => console.error('session error', error));
    try {
      const peerSettings = once(session, 'remoteSettings');
      await once(session, 'connect');
      await peerSettings;
      await new Promise<void>((resolve, reject) =>
        session.settings({ initialWindowSize: 32768 }, (error: Error) =>
          error ? reject(error) : resolve(),
        ),
      );
      assert.equal(session.localSettings.initialWindowSize, 32768);
      const ping = Buffer.from('12345678');
      await Promise.all(
        Array.from(
          { length: 3 },
          () =>
            new Promise<void>((resolve, reject) =>
              session.ping(ping, (error: Error, duration: number, echoed: Buffer) => {
                if (error) return reject(error);
                assert.deepEqual(echoed, ping);
                assert.ok(duration >= 0);
                resolve();
              }),
            ),
        ),
      );
      const bytes = Buffer.from(Array.from({ length: 200000 }, (_, index) => index % 256));
      await Promise.all(
        Array.from({ length: 4 }, async (_, index) => {
          const stream = session.request({ ':method': 'POST', ':path': '/' + index });
          const received = body(stream);
          const headers = once(stream, 'response');
          stream.end(bytes);
          assert.equal((await headers)[0]['x-path'], '/' + index);
          assert.deepEqual(await received, bytes);
        }),
      );
      const closed = once(session, 'close');
      session.close();
      await closed;
    } finally {
      session.destroy();
      await closeServer(server);
    }
  },
);

test(
  'local HTTP/2 server supports a native client, trailers, and compatibility request/response objects',
  { timeout: 5000 },
  async () => {
    const server = local.createServer((request: any, response: any) => {
      assert.equal(request.httpVersion, '2.0');
      response.setHeader('x-request-path', request.url);
      response.addTrailers({ 'x-finished': 'yes' });
      request.pipe(response);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const session = http2.connect(`http://127.0.0.1:${server.address().port}`);
    try {
      const stream = session.request({ ':method': 'POST', ':path': '/compat' });
      const received = body(stream),
        trailers = once(stream, 'trailers'),
        headers = once(stream, 'response');
      stream.end('HTTP/2 — sample 🌍');
      assert.equal((await headers)[0]['x-request-path'], '/compat');
      assert.equal((await received).toString(), 'HTTP/2 — sample 🌍');
      assert.equal((await trailers)[0]['x-finished'], 'yes');
    } finally {
      session.destroy();
      await closeServer(server);
    }
  },
);

test(
  'local HTTP/2 negotiates h2 over native TLS and rejects new streams after graceful close',
  { timeout: 5000 },
  async () => {
    const server = http2.createSecureServer({ key, cert });
    server.on('stream', (stream) => {
      stream.respond();
      stream.end('secure');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const session = local.connect(`https://localhost:${(server.address() as any).port}`, {
      ca: cert,
      family: 4,
    });
    try {
      const stream = session.request();
      const received = body(stream);
      assert.equal((await received).toString(), 'secure');
      assert.equal(session.alpnProtocol, 'h2');
      session.close();
      assert.throws(() => session.request(), { code: 'ERR_HTTP2_GOAWAY_SESSION' });
    } finally {
      session.destroy();
      await closeServer(server);
    }
  },
);

test('HTTP/2 settings are encoded locally and match native Node bytes', () => {
  const settings = {
    enablePush: false,
    initialWindowSize: 123456,
    maxFrameSize: 32768,
    headerTableSize: 8192,
  };
  assert.deepEqual(getPackedSettings(settings), http2.getPackedSettings(settings));
  assert.deepEqual(
    getUnpackedSettings(getPackedSettings(settings)),
    http2.getUnpackedSettings(http2.getPackedSettings(settings)),
  );
  assert.throws(() => getPackedSettings({ maxFrameSize: 1 }));
});

test(
  'secure HTTP/2 server negotiates HTTP/1 fallback using local framing',
  { timeout: 5000 },
  async () => {
    const server = local.createSecureServer(
      { key, cert, allowHTTP1: true },
      (request: any, response: any) => response.end(request.httpVersion),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const https = await import('node:https');
    const session = http2.connect(`https://localhost:${server.address().port}`, {
      ca: cert,
      family: 4,
    });
    try {
      const request = https.get({
        host: '127.0.0.1',
        port: server.address().port,
        ca: cert,
        agent: false,
      });
      const [response] = await once(request, 'response');
      assert.equal((await body(response)).toString(), '1.1');
      const stream = session.request();
      assert.equal((await body(stream)).toString(), '2.0');
    } finally {
      session.destroy();
      await closeServer(server);
    }
  },
);

test(
  'HTTP/2 handles pushed streams, informational headers, and trailers from a native peer',
  { timeout: 5000 },
  async () => {
    const server = http2.createServer();
    server.on('stream', (stream) => {
      stream.pushStream({ ':path': '/push' }, (error, pushed) => {
        assert.ifError(error);
        pushed.respond();
        pushed.end('pushed');
      });
      stream.additionalHeaders({ ':status': 103, link: '</asset>' });
      stream.respond({ ':status': 200 }, { waitForTrailers: true });
      stream.on('wantTrailers', () => stream.sendTrailers({ 'x-end': 'yes' }));
      stream.end('main');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const session = local.connect(`http://127.0.0.1:${(server.address() as any).port}`);
    try {
      const pushed = new Promise<Buffer>((resolve, reject) =>
        session.on('stream', (stream: any) => body(stream).then(resolve, reject)),
      );
      const stream = session.request(),
        info = once(stream, 'headers'),
        trailers = once(stream, 'trailers');
      assert.equal((await body(stream)).toString(), 'main');
      assert.equal((await pushed).toString(), 'pushed');
      assert.equal((await info)[0][':status'], 103);
      assert.equal((await trailers)[0]['x-end'], 'yes');
    } finally {
      session.destroy();
      await closeServer(server);
    }
  },
);

test('HTTP/2 rejects invalid boolean settings before coercion', () => {
  const bytes = Buffer.from([0, 2, 0, 0, 0, 2]);
  assert.throws(() => getUnpackedSettings(bytes, { validate: true }), RangeError);
});

test(
  'HTTP/2 closes before connection without leaving queued requests waiting',
  { timeout: 5000 },
  async () => {
    const server = http2.createServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const session = local.connect(`http://127.0.0.1:${(server.address() as any).port}`);
    const request = session.request();
    const error = new Promise<any>((resolve) => request.once('error', resolve));
    const closed = once(session, 'close');
    try {
      session.close();
      assert.equal((await error).code, 'ERR_HTTP2_GOAWAY_SESSION');
      await closed;
    } finally {
      session.destroy();
      await closeServer(server);
    }
  },
);
