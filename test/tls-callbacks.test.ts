import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { once } from 'node:events';
import { NetworkKernel } from '../src/kernel/network.js';
import { createNetwork } from '../src/runtime/network.js';
import { createTls } from '../src/runtime/tls-core.js';
import { encodeValue, decodeValue } from '../src/values.js';
import { key, cert } from '../examples/compatibility/src/fixtures/tls.js';

function realm() {
  let sequence = 0,
    callbackSequence = 0;
  const callbacks = new Map<number, Function>();
  const listeners = new Map<number, Function>();
  const copy = (value: any) => decodeValue(encodeValue(value));
  const kernel = new NetworkKernel(
    (handle, event, ...args) => listeners.get(handle)?.(event, copy(args)),
    () => ++sequence,
    {
      sync: (id, args) => copy(callbacks.get(id)!(...copy(args))),
      async: async (id, args) => copy(await callbacks.get(id)!(...copy(args))),
    },
  );
  const call = async (operation: string, ...args: any[]) =>
    copy(await kernel.execute(operation, copy(args)));
  const sync = (operation: string, ...args: any[]) =>
    copy(kernel.executeSync(operation, copy(args)));
  const subscribe = (handle: number, callback: any) => {
    listeners.set(handle, callback);
    return () => {
      listeners.delete(handle);
    };
  };
  const network = createNetwork(call, subscribe, sync);
  const local = createTls(call, subscribe, sync, network, (callback) => {
    const id = ++callbackSequence;
    callbacks.set(id, callback);
    return id;
  });
  return { tls: local, close: () => kernel.close() };
}
async function body(socket: any) {
  const chunks: Buffer[] = [];
  socket.on('data', (bytes: Buffer) => chunks.push(bytes));
  await once(socket, 'end');
  return Buffer.concat(chunks).toString();
}

test(
  'SNI and ALPN callbacks execute in their owning realm with asynchronous certificate selection',
  { timeout: 5000 },
  async () => {
    const local = realm();
    const context = local.tls.createSecureContext({ key, cert });
    const calls: string[] = [];
    const server = local.tls.createServer(
      {
        SNICallback(name: string, done: Function) {
          calls.push('sni:' + name);
          setTimeout(() => done(null, context), 1);
        },
        ALPNCallback({ protocols }: any) {
          calls.push('alpn');
          return protocols.includes('sample') ? 'sample' : undefined;
        },
      },
      (socket: any) => socket.end('callbacks'),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const socket = tls.connect({
      host: '127.0.0.1',
      port: server.address().port,
      ca: cert,
      servername: 'localhost',
      ALPNProtocols: ['sample'],
    });
    try {
      assert.equal(await body(socket), 'callbacks');
      assert.equal(socket.alpnProtocol, 'sample');
      assert.ok(calls.includes('sni:localhost'));
      assert.ok(calls.includes('alpn'));
    } finally {
      socket.destroy();
      await local.close();
    }
  },
);

test(
  'TLS server contexts and ticket keys retain synchronous native contracts',
  { timeout: 5000 },
  async () => {
    const local = realm();
    const server = local.tls.createServer({ key, cert }, (socket: any) => socket.end('context'));
    try {
      const ticket = server.getTicketKeys();
      assert.equal(ticket.length, 48);
      const changed = Buffer.alloc(48, 7);
      server.setTicketKeys(changed);
      assert.deepEqual(Buffer.from(server.getTicketKeys()), changed);
      server.setSecureContext({ key, cert });
      server.addContext('localhost', local.tls.createSecureContext({ key, cert }));
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const socket = tls.connect({
        host: '127.0.0.1',
        port: server.address().port,
        ca: cert,
        servername: 'localhost',
      });
      assert.equal(await body(socket), 'context');
      socket.destroy();
    } finally {
      await local.close();
    }
  },
);

test(
  'PSK callbacks retain binary keys and the same local TLS socket on the accepting side',
  { timeout: 5000 },
  async () => {
    const local = realm();
    const secret = Buffer.alloc(32, 0xab);
    let callbackSocket: any,
      acceptedSocket: any,
      clientCalls = 0;
    const options = {
      ciphers: 'PSK-AES128-GCM-SHA256',
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
    };
    const server = local.tls.createServer(
      {
        ...options,
        pskCallback(socket: any, identity: string) {
          callbackSocket = socket;
          assert.equal(identity, 'sample');
          return secret;
        },
      },
      (socket: any) => {
        acceptedSocket = socket;
        socket.end('psk');
      },
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const socket = local.tls.connect({
      ...options,
      host: '127.0.0.1',
      port: server.address().port,
      // PSK authenticates with a shared key; Node requires an explicit identity check when no certificate is used.
      checkServerIdentity: () => undefined,
      pskCallback() {
        clientCalls++;
        return { identity: 'sample', psk: secret };
      },
    });
    try {
      assert.equal(await body(socket), 'psk');
      assert.equal(clientCalls, 1);
      assert.equal(acceptedSocket, callbackSocket);
      assert.ok(callbackSocket instanceof local.tls.TLSSocket);
    } finally {
      socket.destroy();
      await local.close();
    }
  },
);

test(
  'TLS 1.2 renegotiation completes a local callback and refreshes handshake state',
  { timeout: 5000 },
  async () => {
    const local = realm();
    const server = tls
      .createServer({ key, cert, maxVersion: 'TLSv1.2' }, (socket) =>
        socket.on('data', (bytes) => socket.write(bytes)),
      )
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    const socket = local.tls.connect({
      host: '127.0.0.1',
      port: (server.address() as any).port,
      ca: cert,
      maxVersion: 'TLSv1.2',
    });
    try {
      await once(socket, 'secureConnect');
      await new Promise<void>((resolve, reject) => {
        assert.equal(
          socket.renegotiate({}, (error: Error) => (error ? reject(error) : resolve())),
          true,
        );
      });
      assert.equal(socket.getProtocol(), 'TLSv1.2');
      const echoed = once(socket, 'data');
      socket.write('after');
      assert.equal((await echoed)[0].toString(), 'after');
    } finally {
      socket.destroy();
      await local.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
