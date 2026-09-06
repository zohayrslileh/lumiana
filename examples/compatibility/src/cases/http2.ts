import http2 from 'node:http2';
import { Buffer } from 'node:buffer';
import { key, cert } from '../fixtures/tls';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const sessions: any[] = [];
  const server = http2.createSecureServer({ key, cert });
  server.on('session', (session) => sessions.push(session));
  server.on('stream', (stream) => {
    stream.respond({ ':status': 200 });
    stream.pipe(stream);
  });
  server.listen(0, '127.0.0.1');
  let client: any;
  try {
    await once(server, 'listening');
    client = http2.connect(`https://localhost:${(server.address() as { port: number }).port}`, {
      ca: cert,
      family: 4,
    });
    await once(client, 'connect');
    const bytes = Buffer.from(Array.from({ length: 200000 }, (_, index) => index % 256));
    await Promise.all(
      Array.from({ length: 4 }, async (_, index) => {
        const stream = client.request({ ':method': 'POST', ':path': '/' + index });
        const headers = once(stream, 'response');
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        const ended = once(stream, 'end');
        stream.end(bytes);
        assert.equal((await headers)[0][':status'], 200);
        await ended;
        assert.deepEqual(Buffer.concat(chunks), bytes);
      }),
    );
    await new Promise<void>((resolve, reject) =>
      client.ping(Buffer.from('12345678'), (error: Error, _time: number, data: Buffer) => {
        if (error) {
          reject(error);
          return;
        }
        assert.equal(data.toString(), '12345678');
        resolve();
      }),
    );
    assert.equal(sessions.length, 1);
    output.textContent =
      'HTTP/2 multiplexed four exact 200,000-byte binary streams over one verified TLS socket.\nHPACK, frames, flow control, and ping run in the browser.';
  } finally {
    client?.destroy();
    sessions.forEach((session) => session.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
