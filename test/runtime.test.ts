import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'buffer';
import { once } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import { installGlobals } from '../src/runtime/globals.js';
import processRuntime from '../src/runtime/process.js';
import { setImmediate, clearImmediate } from '../src/runtime/timers.js';
import { FileKernel } from '../src/kernel/files.js';
import { NetworkKernel } from '../src/kernel/network.js';
import { createFileSystem } from '../src/runtime/filesystem.js';
import { createNetwork } from '../src/runtime/network.js';
import { createHttp } from '../src/runtime/http-core.js';
import { createRequire } from '../src/runtime/module.js';
import crypto from '../src/runtime/crypto.js';
import zlib from '../src/runtime/zlib.js';
import * as runtimeURL from '../src/runtime/url.js';
import runtimeUtil, { inherits } from '../src/runtime/util.js';
import workerThreads from '../src/runtime/worker-threads.js';
import runtimeTTY from '../src/runtime/tty.js';
import { dispatchKernel, installKernel, removeKernel } from '../src/runtime/bridge.js';

test('Node global capabilities are available through the realm and its aliases', () => {
  const context = createContext({ native: true });
  const realm = runInContext('globalThis', context);
  const bindings = { global: realm, process: processRuntime, Buffer, setImmediate, clearImmediate };
  assert.equal(installGlobals(realm, bindings), realm);
  assert.equal(runInContext('global.process', context), processRuntime);
  assert.equal(runInContext('const alias = global; alias["process"]', context), processRuntime);
  assert.equal(runInContext('global.global === globalThis', context), true);
  assert.equal(runInContext('global.Buffer.from("hello").toString()', context), 'hello');
  assert.equal(runInContext('global.setImmediate', context), setImmediate);
  assert.equal(runInContext('global.clearImmediate', context), clearImmediate);
  // Accessing an absent standard stream is a valid comparison, not a missing process object.
  assert.equal(runInContext('global.process.stdout === undefined', context), true);
  installGlobals(realm, { process: {}, native: false });
  assert.equal(realm.process, processRuntime);
  assert.equal(realm.native, true, 'existing realm capabilities retain their identity');
});

test('createRequire keeps portable CommonJS constructors local', () => {
  const require = createRequire(import.meta.url, 'test/runtime.test.ts');
  const EventEmitter = require('events');
  const stream = require('stream');
  const assertModule = require('assert');
  assert.equal(new EventEmitter() instanceof EventEmitter, true);
  assert.equal(new stream.PassThrough() instanceof stream.PassThrough, true);
  assert.equal(typeof assertModule.equal, 'function');
  assert.equal(require('sqlite'), require('node:sqlite'));
  assert.equal(typeof require('node:sqlite').DatabaseSync, 'function');
});

test('crypto and compression execute locally with binary Node-compatible values', () => {
  const bytes = crypto.randomFillSync(Buffer.alloc(1024 * 1024));
  assert.equal(bytes.byteLength, 1024 * 1024);
  assert.equal(
    crypto.createHash('sha256').update('lumiana').digest('hex'),
    'eddec645f3362a73ebb250129b196d57253d78f670655ab9a9472eaf814c1893',
  );
  assert.deepEqual(zlib.gunzipSync(zlib.gzipSync(bytes)), bytes);
});

test('promisify honors the process-wide Node custom implementation contract', async () => {
  const callback = ((done: (error: null, value: string) => void) => done(null, 'generic')) as any;
  callback[runtimeUtil.promisify.custom] = () => Promise.resolve({ first: 1, second: 2 });
  assert.deepEqual(await runtimeUtil.promisify(callback)(), { first: 1, second: 2 });
  assert.equal(runtimeUtil.promisify.custom, Symbol.for('nodejs.util.promisify.custom'));
});

test('util inheritance is available without depending on its own compatibility module', () => {
  assert.equal(runtimeUtil.inherits, inherits);
  function Parent(this: any) {}
  Parent.prototype.read = () => 42;
  function Child(this: any) {}
  runtimeUtil.inherits(Child, Parent);
  const child = new (Child as any)();
  assert.equal(child.read(), 42);
  assert.equal((Child as any).super_, Parent);
  assert.equal(child.constructor, Child);
});

test('worker threads expose the browser-local main-thread contract', () => {
  assert.equal(workerThreads.isMainThread, true);
  assert.equal(workerThreads.threadId, 0);
  assert.equal(workerThreads.parentPort, null);
  workerThreads.setEnvironmentData('runtime-test', { local: true });
  assert.deepEqual(workerThreads.getEnvironmentData('runtime-test'), { local: true });
});

test('TTY file descriptors retain a local readable stream', async () => {
  const owner = {};
  const operations: string[] = [];
  installKernel(
    owner,
    async (operation, ...args) => {
      operations.push(operation);
      if (operation === 'fs.fd.readStream') return 7;
      if (operation === 'fs.fd.readStream.attach') {
        queueMicrotask(() => {
          dispatchKernel(7, 'data', [new TextEncoder().encode('terminal')]);
          dispatchKernel(7, 'end', []);
        });
      }
    },
    (operation) => {
      assert.equal(operation, 'fs.isatty');
      return true;
    },
  );
  try {
    assert.equal(runtimeTTY.isatty(9), true);
    const terminal = new runtimeTTY.ReadStream(9);
    terminal.setEncoding('utf8');
    let output = '';
    terminal.on('data', (chunk) => (output += chunk));
    await once(terminal, 'end');
    assert.equal(output, 'terminal');
    assert.deepEqual(operations.slice(0, 2), ['fs.fd.readStream', 'fs.fd.readStream.attach']);
  } finally {
    removeKernel(owner);
  }
});

test('URL values and path conversions execute locally with Node-compatible semantics', () => {
  const file = '/tmp/Lumiana file#1?.txt';
  const url = runtimeURL.pathToFileURL(file, { windows: false });
  assert.equal(url.href, 'file:///tmp/Lumiana%20file%231%3F.txt');
  assert.equal(runtimeURL.fileURLToPath(url, { windows: false }), file);
  assert.equal(
    runtimeURL.fileURLToPath('file:///C:/Lumiana/file.txt', { windows: true }),
    'C:\\Lumiana\\file.txt',
  );
  assert.equal(runtimeURL.domainToASCII('español.com'), 'xn--espaol-zwa.com');
  assert.equal(runtimeURL.domainToUnicode('xn--espaol-zwa.com'), 'español.com');
  assert.equal(
    runtimeURL.format(new URL('https://a:b@xn--g6w251d/path'), { unicode: true }),
    'https://a:b@測試/path',
  );
  assert.throws(
    () => runtimeURL.fileURLToPath('https://example.com/file', { windows: false }),
    (error: any) => error.code === 'ERR_INVALID_URL_SCHEME',
  );
});

test('createRequire rejects a statically unavailable optional dependency locally', () => {
  const require = createRequire(import.meta.url, 'package/index.js', ['optional-native']);
  assert.throws(
    () => require('optional-native'),
    (error: any) => error.code === 'MODULE_NOT_FOUND',
  );
});

test('filesystem values stay local while the kernel receives operations and opaque handles', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-kernel-'));
  const file = path.join(directory, 'message.txt');
  const kernel = new FileKernel();
  const operations: string[] = [];
  const runtime = createFileSystem(async (operation, ...args) => {
    operations.push(operation);
    return kernel.execute(operation, args);
  });

  try {
    await runtime.writeFile(file, 'hello');
    const bytes = await runtime.readFile(file);
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.toString(), 'hello');
    assert.equal(await runtime.readFile(file, 'utf8'), 'hello');

    const stat = await runtime.stat(file);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isDirectory(), false);
    assert.ok(stat.mtime instanceof Date);

    const handle = await runtime.open(file, 'r+');
    assert.equal(Object.getPrototypeOf(handle).constructor.name, 'FileHandle');
    assert.equal(await handle.readFile('utf8'), 'hello');
    await handle.truncate(2);
    await handle.close();
    assert.equal(await runtime.readFile(file, 'utf8'), 'he');

    assert.deepEqual(operations, [
      'fs.writeFile',
      'fs.readFile',
      'fs.readFile',
      'fs.stat',
      'fs.open',
      'fs.handle.readFile',
      'fs.handle.truncate',
      'fs.handle.close',
      'fs.readFile',
    ]);
  } finally {
    await kernel.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('directory entries returned by the kernel have local Node-compatible behavior', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-directory-'));
  const kernel = new FileKernel();
  const runtime = createFileSystem((operation, ...args) => kernel.execute(operation, args));

  try {
    await runtime.mkdir(path.join(directory, 'nested'));
    await runtime.writeFile(path.join(directory, 'file.txt'), 'value');
    const entries = await runtime.readdir(directory, { withFileTypes: true });
    assert.deepEqual(
      entries.map((entry: any) => [entry.name, entry.isDirectory(), entry.isFile()]),
      [
        ['file.txt', false, true],
        ['nested', true, false],
      ],
    );
    assert.ok(entries.every((entry: any) => entry.constructor.name === 'Dirent'));
  } finally {
    await kernel.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('socket libraries retain local servers, sockets, streams and callbacks', async () => {
  const listeners = new Map<number, Set<(event: string, args: any[]) => void>>();
  const network = createNetwork(
    (operation, ...args) => kernel.execute(operation, args),
    (handle, listener) => {
      const set = listeners.get(handle) ?? new Set();
      set.add(listener);
      listeners.set(handle, set);
      return () => set.delete(listener);
    },
  );
  const kernel = new NetworkKernel((handle, event, ...args) => {
    for (const listener of listeners.get(handle) ?? []) listener(event, args);
  });
  const server = network.createServer((socket: any) => {
    assert.equal(socket.constructor, network.Socket);
    socket.on('data', (data: Buffer) => socket.write(data));
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.equal(typeof address.port, 'number');
    const socket = network.createConnection(address.port, '127.0.0.1');
    assert.equal(socket.constructor, network.Socket);
    await once(socket, 'connect');
    socket.write(Buffer.from([0, 128, 255]));
    const [echo] = await once(socket, 'data');
    assert.deepEqual(echo, Buffer.from([0, 128, 255]));
    socket.end();
    await once(socket, 'close');
    server.close();
    await once(server, 'close');
  } finally {
    await kernel.close();
  }
});

test('HTTP application callbacks and message objects execute locally', async () => {
  const listeners = new Map<number, Set<(event: string, args: any[]) => void>>();
  const subscribe = (handle: number, listener: (event: string, args: any[]) => void) => {
    const set = listeners.get(handle) ?? new Set();
    set.add(listener);
    listeners.set(handle, set);
    return () => set.delete(listener);
  };
  const kernel = new NetworkKernel((handle, event, ...args) => {
    for (const listener of listeners.get(handle) ?? []) listener(event, args);
  });
  const runtime = createHttp((operation, ...args) => kernel.execute(operation, args), subscribe);
  let requestPrototype = '';
  let responsePrototype = '';
  const server = runtime.createServer((request: any, response: any) => {
    requestPrototype = request.constructor.name;
    responsePrototype = response.constructor.name;
    response.setHeader('x-lumiana', 'local');
    response.end(`Hello ${request.url}`);
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/runtime`);
    assert.equal(await response.text(), 'Hello /runtime');
    assert.equal(response.headers.get('x-lumiana'), 'local');
    assert.equal(requestPrototype, 'IncomingMessage');
    assert.equal(responsePrototype, 'ServerResponse');
    server.close();
    await once(server, 'close');
  } finally {
    await kernel.close();
  }
});
