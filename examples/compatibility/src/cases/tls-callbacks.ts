import tls from 'node:tls';
import { Buffer } from 'node:buffer';
import { key, cert } from '../fixtures/tls';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const context = tls.createSecureContext({ key, cert });
  const calls: string[] = [];
  const server = tls.createServer(
    {
      SNICallback(name, done) {
        calls.push('SNI: ' + name);
        queueMicrotask(() => done(null, context));
      },
      ALPNCallback({ protocols }) {
        calls.push('ALPN');
        return protocols.includes('sample') ? 'sample' : undefined;
      },
    },
    (socket) => socket.end('browser callbacks'),
  );
  server.listen(0, '127.0.0.1');
  let client: tls.TLSSocket | undefined;
  try {
    await once(server, 'listening');
    client = tls.connect({
      host: '127.0.0.1',
      port: (server.address() as { port: number }).port,
      ca: cert,
      servername: 'localhost',
      ALPNProtocols: ['sample'],
    });
    let text = '';
    client.setEncoding('utf8');
    client.on('data', (bytes) => (text += bytes));
    await once(client, 'end');
    assert.equal(text, 'browser callbacks');
    assert.equal(client.alpnProtocol, 'sample');
    assert.equal(calls.includes('SNI: localhost'), true);
    assert.equal(calls.includes('ALPN'), true);
  } finally {
    client?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const secret = Buffer.alloc(32, 0xab); // Public fixture key used only for this loopback test.
  const options = {
    ciphers: 'PSK-AES128-GCM-SHA256',
    minVersion: 'TLSv1.2' as const,
    maxVersion: 'TLSv1.2' as const,
  };
  let callbackSocket: any;
  const psk = tls.createServer(
    {
      ...options,
      pskCallback(socket, identity) {
        callbackSocket = socket;
        assert.equal(identity, 'sample');
        return secret;
      },
    },
    (socket) => {
      assert.equal(socket, callbackSocket);
      socket.end('PSK');
    },
  );
  psk.listen(0, '127.0.0.1');
  try {
    await once(psk, 'listening');
    client = tls.connect({
      ...options,
      host: '127.0.0.1',
      port: (psk.address() as { port: number }).port,
      checkServerIdentity: () => undefined, // PSK authentication has no certificate to check.
      pskCallback() {
        calls.push('PSK');
        return { identity: 'sample', psk: secret };
      },
    });
    client.resume();
    await once(client, 'end');
    assert.equal(calls.includes('PSK'), true);
    output.textContent =
      'SNI selected a certificate asynchronously; ALPN and PSK returned synchronous results from browser callbacks.\nThe accepting PSK callback and listener received the same local TLSSocket.';
  } finally {
    client?.destroy();
    await new Promise<void>((resolve) => psk.close(() => resolve()));
  }
}
