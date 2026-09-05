import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decode } from '@msgpack/msgpack';
import { build as bundle } from 'esbuild';
import { transformSource } from '../src/build.js';

const require = createRequire(import.meta.url);

async function browserExpressBundle(directory: string): Promise<string> {
  const output = path.join(directory, 'express.mjs');
  const shims = {
    fs: path.join(directory, 'fs.mjs'),
    crypto: path.join(directory, 'crypto.mjs'),
    empty: path.join(directory, 'empty.mjs'),
  };
  await Promise.all([
    fs.writeFile(
      shims.fs,
      'export class Stats{};export function createReadStream(){throw new Error("not used")};export default {Stats,createReadStream};',
    ),
    fs.writeFile(
      shims.crypto,
      'export function createHash(){throw new Error("not used")};export default {createHash};',
    ),
    fs.writeFile(shims.empty, 'export default {};'),
  ]);
  const runtime = (name: string) => path.resolve(`dist/runtime/${name}.js`);
  const local = (name: string) => require.resolve(name);
  const replacements: Record<string, string> = {
    http: runtime('http'),
    'node:http': runtime('http'),
    net: runtime('net'),
    'node:net': runtime('net'),
    assert: local('assert/'),
    'node:assert': local('assert/'),
    buffer: local('buffer/'),
    'node:buffer': local('buffer/'),
    events: local('events/'),
    'node:events': local('events/'),
    path: local('path-browserify'),
    'node:path': local('path-browserify'),
    process: local('process/browser'),
    'node:process': local('process/browser'),
    querystring: local('querystring-es3'),
    'node:querystring': local('querystring-es3'),
    stream: local('stream-browserify'),
    'node:stream': local('stream-browserify'),
    string_decoder: local('string_decoder/'),
    'node:string_decoder': local('string_decoder/'),
    url: local('url/'),
    'node:url': local('url/'),
    fs: shims.fs,
    'node:fs': shims.fs,
    crypto: shims.crypto,
    'node:crypto': shims.crypto,
    async_hooks: shims.empty,
    'node:async_hooks': shims.empty,
    zlib: shims.empty,
    'node:zlib': shims.empty,
  };
  await bundle({
    stdin: {
      contents: "import express from 'express';export default express;",
      resolveDir: path.resolve('example'),
      sourcefile: 'express-runtime-entry.js',
    },
    outfile: output,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      {
        name: 'lumiana-runtime-contracts',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            const replacement = replacements[args.path];
            return replacement ? { path: replacement } : undefined;
          });
        },
      },
    ],
  });
  return output;
}
class XMLHttpRequest {
  static requests = 0;
  static operations: string[] = [];
  status = 0;
  responseText = '';
  url = '';
  headers: string[] = [];
  open(_method: string, url: string, _async: boolean) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers.push('-H', `${k}: ${v}`);
  }
  send(body: Uint8Array) {
    XMLHttpRequest.requests++;
    const packet = decode(body) as any;
    XMLHttpRequest.operations.push(packet.invocation?.operation ?? packet.type);
    const result = execFileSync(
      'curl',
      [
        '-sS',
        '--compressed',
        '--max-time',
        '15',
        ...this.headers,
        '--data-binary',
        '@-',
        '-w',
        '\n%{http_code}',
        this.url,
      ],
      { input: body, maxBuffer: 20 * 1024 * 1024 },
    ).toString();
    const line = result.lastIndexOf('\n');
    this.status = Number(result.slice(line + 1));
    this.responseText = result.slice(0, line);
  }
}
test('client contract through real HTTP, binary WebSocket and an isolated native worker', async () => {
  const child = fork(new URL('./fixtures/host.mjs', import.meta.url), {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const [{ port, otherPort, pid }] = await once(child, 'message');
  const url = `http://127.0.0.1:${port}`;
  let browserRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    browserRequests++;
    return originalFetch(...args);
  };
  Object.assign(globalThis, { XMLHttpRequest, location: { href: url + '/', origin: url } });
  const {
    lumiana,
    connect,
    node,
    hybridFetch,
    HybridWebSocket,
    importNode,
    nativeModule,
    nativeBindings,
    invokeMember,
  } = await import('../dist/client.js');
  const browserFs = await import('../dist/runtime/fs-promises.js');
  const browserHttp = await import('../dist/runtime/http.js');
  const browserNet = await import('../dist/runtime/net.js');
  const creds = { username: 'test', password: 'secret', url };
  const compile = async (source: string, origin = 'reader.js') => {
    const result = await transformSource(source, origin, {
      place: async () => ({ native: true }),
      origin,
      client: new URL('../dist/client.js', import.meta.url).href,
      access: new URL('../dist/access.js', import.meta.url).href,
    });
    return import(
      'data:text/javascript;base64,' + Buffer.from(result?.code ?? source).toString('base64')
    );
  };
  try {
    const reader = await compile('export const read = (value) => value.child.value;');
    assert.equal(reader.read({ child: { value: 7 } }), 7);
    assert.throws(() => lumiana.status, /not connected/);
    assert.throws(() => node('node:fs'), /not connected/);
    await assert.rejects(browserFs.readFile('/not-connected'), /not connected/);
    await assert.rejects(
      connect.credentials({ ...creds, password: 'wrong' }),
      /Invalid credentials/,
    );
    const first = connect.credentials(creds);
    await assert.rejects(connect.credentials(creds), /being established/);
    assert.equal(await first, lumiana);
    assert.equal(await connect.credentials(creds), lumiana);
    await assert.rejects(connect.credentials({ ...creds, password: 'different' }), /different/);
    assert.equal((await lumiana.status()).pid, pid);
    const kernelDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-browser-fs-'));
    const kernelFile = path.join(kernelDirectory, 'message.bin');
    try {
      const beforeKernel = XMLHttpRequest.requests;
      await browserFs.writeFile(kernelFile, new Uint8Array([0, 128, 255]));
      const kernelBytes = await browserFs.readFile(kernelFile);
      assert.equal(Buffer.isBuffer(kernelBytes), true);
      assert.deepEqual(kernelBytes, Buffer.from([0, 128, 255]));
      const kernelStat = await browserFs.stat(kernelFile);
      assert.equal(kernelStat.isFile(), true);
      assert.equal(Object.getPrototypeOf(kernelStat).constructor.name, 'Stats');
      assert.equal(
        XMLHttpRequest.requests,
        beforeKernel,
        'filesystem kernel operations use the established WebSocket',
      );
    } finally {
      await browserFs.rm(kernelDirectory, { recursive: true, force: true });
    }
    const beforeNetworkKernel = XMLHttpRequest.requests;
    const kernelServer = browserNet.createServer((socket: any) =>
      socket.on('data', (data: Buffer) => socket.write(data)),
    );
    kernelServer.listen(0, '127.0.0.1');
    await once(kernelServer, 'listening');
    const kernelSocket = browserNet.createConnection(kernelServer.address().port, '127.0.0.1');
    await once(kernelSocket, 'connect');
    kernelSocket.write(Buffer.from([1, 2, 3]));
    const [kernelEcho] = await once(kernelSocket, 'data');
    assert.deepEqual(kernelEcho, Buffer.from([1, 2, 3]));
    kernelSocket.end();
    await once(kernelSocket, 'close');
    kernelServer.close();
    await once(kernelServer, 'close');
    assert.equal(
      XMLHttpRequest.requests,
      beforeNetworkKernel,
      'socket kernel operations and events share the established WebSocket',
    );
    const beforeHttpKernel = XMLHttpRequest.requests;
    let requestClass = '';
    let responseClass = '';
    const kernelHttp = browserHttp.createServer((request: any, response: any) => {
      requestClass = request.constructor.name;
      responseClass = response.constructor.name;
      response.setHeader('x-runtime', 'local');
      response.end('Hello from the browser runtime');
    });
    kernelHttp.listen(0, '127.0.0.1');
    await once(kernelHttp, 'listening');
    const kernelHttpResponse = await originalFetch(
      `http://127.0.0.1:${kernelHttp.address().port}/`,
    );
    assert.equal(await kernelHttpResponse.text(), 'Hello from the browser runtime');
    assert.equal(kernelHttpResponse.headers.get('x-runtime'), 'local');
    assert.equal(requestClass, 'IncomingMessage');
    assert.equal(responseClass, 'ServerResponse');
    kernelHttp.close();
    await once(kernelHttp, 'close');
    assert.equal(
      XMLHttpRequest.requests,
      beforeHttpKernel,
      'HTTP kernel operations and request events share the established WebSocket',
    );
    const expressDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-express-runtime-'));
    try {
      const express = (
        await import(pathToFileURL(await browserExpressBundle(expressDirectory)).href)
      ).default;
      const application = express();
      application.disable('etag');
      application.get('/hello/:name', (request: any, response: any) => {
        response.status(201).json({ hello: request.params.name, runtime: 'browser' });
      });
      const beforeExpressKernel = XMLHttpRequest.requests;
      const expressServer = application.listen(0, '127.0.0.1');
      await once(expressServer, 'listening');
      const expressResponse = await originalFetch(
        `http://127.0.0.1:${expressServer.address().port}/hello/Lumiana`,
      );
      assert.equal(expressResponse.status, 201);
      assert.deepEqual(await expressResponse.json(), { hello: 'Lumiana', runtime: 'browser' });
      expressServer.close();
      await once(expressServer, 'close');
      assert.equal(
        XMLHttpRequest.requests,
        beforeExpressKernel,
        'a bundled Express application executes locally over the HTTP kernel',
      );
    } finally {
      await fs.rm(expressDirectory, { recursive: true, force: true });
    }
    node('node:process').env.LUMIANA_STRINGIFY_TEST = 'stringify-ok';
    const beforeStringify = XMLHttpRequest.requests;
    const serialized = await compile(
      'export const value = JSON.parse(JSON.stringify(process.env)).LUMIANA_STRINGIFY_TEST;',
    );
    assert.equal(serialized.value, 'stringify-ok');
    assert.equal(
      XMLHttpRequest.requests - beforeStringify,
      1,
      'portable intrinsic and native argument execute as one operation',
    );
    const customized = await compile('export const read = () => JSON.stringify(process.env);');
    const originalStringify = JSON.stringify;
    try {
      JSON.stringify = function () {
        return this === JSON ? 'custom stringify' : 'wrong receiver';
      } as typeof JSON.stringify;
      assert.equal(customized.read() === 'custom stringify', true);
    } finally {
      JSON.stringify = originalStringify;
    }
    const beforeHome = XMLHttpRequest.requests;
    assert.equal((await compile('export const value = process.env.HOME;')).value, process.env.HOME);
    assert.equal(XMLHttpRequest.requests - beforeHome, 1, 'global property chain takes one XHR');
    const beforeModule = XMLHttpRequest.requests;
    const moduleRead = await compile("export const value = require('node:fs').constants.F_OK;");
    assert.equal(moduleRead.value, 0);
    assert.equal(XMLHttpRequest.requests - beforeModule, 1, 'module property chain takes one XHR');
    const tree = node('./test/fixtures/runtime.cjs').readTree();
    const beforeTree = XMLHttpRequest.requests;
    assert.equal(reader.read(tree), 42);
    assert.equal(
      XMLHttpRequest.requests - beforeTree,
      1,
      'arbitrary reference chain takes one XHR',
    );
    const asyncModule = await importNode('./test/fixtures/async.mjs');
    assert.equal(asyncModule.value, 42);
    const namespace = nativeModule('node:fs', 'namespace');
    assert.equal(namespace.default.readFileSync, namespace.readFileSync);
    const runtime = node('./test/fixtures/runtime.cjs');
    const counter = new runtime.Counter(5);
    assert.equal(counter.add(2), counter);
    assert.equal(counter.value, 7);
    counter.value = 9;
    assert.equal(counter.value, 9);
    assert.equal(
      runtime.callback((n: number) => n + counter.value),
      51,
    );
    assert.deepEqual([...runtime.sort((a: number, b: number) => a - b)], [1, 2, 3]);
    const ready = new Promise<number>((resolve) => {
      const emitter = runtime.create();
      emitter.once('ready', resolve);
    });
    assert.equal(await ready, 42);
    const emitter = new (node('node:events').EventEmitter)();
    let calls = 0;
    const listener = () => calls++;
    emitter.on('x', listener);
    emitter.emit('x');
    emitter.off('x', listener);
    emitter.emit('x');
    assert.equal(calls, 1);
    assert.equal(await runtime.promise(), 42);
    assert.throws(() => runtime.error(), {
      name: 'TypeError',
      message: 'native failure',
      code: 'E_NATIVE',
    });
    try {
      runtime.throwValue(42);
      assert.fail('expected throw');
    } catch (error) {
      assert.equal(error, 42);
    }
    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...values) => {
      logs.push(values);
    };
    try {
      runtime.log();
      assert.deepEqual(logs[0], ['native log', 42]);
      runtime.stdout();
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.ok(logs.some((args) => String(args[0]).includes('native stdout')));
    } finally {
      console.log = originalLog;
    }
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    assert.deepEqual(runtime.echo(bytes), bytes);
    const values = runtime.values();
    assert.equal(values.map.get('a'), 1);
    assert.equal(values.date.getTime(), 0);
    assert.equal(values.big, 2n ** 80n);
    assert.equal(runtime.echo(values.symbol), values.symbol);
    assert.equal(await (await hybridFetch(url + '/same')).text(), 'browser');
    const before = browserRequests;
    const other = `http://127.0.0.1:${otherPort}`;
    assert.equal(await (await hybridFetch(other + '/cross')).text(), 'remote');
    assert.equal(browserRequests, before);
    assert.equal(
      await (
        await hybridFetch(other + '/echo', { method: 'POST', body: new Uint8Array([0, 128, 255]) })
      )
        .arrayBuffer()
        .then((b) => new Uint8Array(b).join(',')),
      '0,128,255',
    );
    const abort = new AbortController();
    const aborted = hybridFetch(other + '/slow', { signal: abort.signal });
    setTimeout(() => abort.abort(), 10);
    await assert.rejects(aborted, { name: 'AbortError' });
    for (const destination of [`ws://127.0.0.1:${port}/echo`, `ws://127.0.0.1:${otherPort}/echo`]) {
      const socket = new HybridWebSocket(destination);
      const echoed = new Promise<string>((resolve, reject) => {
        socket.onopen = () => socket.send('hello');
        socket.onmessage = (event) => resolve(event.data);
        socket.onerror = reject;
      });
      assert.equal(await echoed, 'hello');
      socket.close();
    }
    const { 0: WebSocketServer } = nativeBindings('ws', 'example/src/entry.ts', {
      0: 'WebSocketServer',
    });
    const wsServer = new WebSocketServer({ port: 0 });
    invokeMember(wsServer, 'on', 'connection', (socket: any) => {
      socket.once('message', (data: Uint8Array) => socket.send(data));
    });
    await new Promise<void>((resolve) => invokeMember(wsServer, 'once', 'listening', resolve));
    const wsPort = invokeMember<{ port: number }>(wsServer, 'address').port;
    const { WebSocket: LocalWebSocket } = await import('ws');
    const wsEcho = await new Promise<Uint8Array>((resolve, reject) => {
      const socket = new LocalWebSocket(`ws://127.0.0.1:${wsPort}`);
      socket.once('open', () => socket.send(new Uint8Array([0, 128, 255])));
      socket.once('message', (data) => {
        resolve(new Uint8Array(data as Buffer));
        socket.close();
      });
      socket.once('error', reject);
    });
    assert.deepEqual(wsEcho, new Uint8Array([0, 128, 255]));
    await new Promise<void>((resolve) => invokeMember(wsServer, 'close', resolve));
    const Readable = node('node:stream').Readable;
    class Stream extends Readable {
      _read() {
        this.push('hello');
        this.push(null);
      }
    }
    const stream = new Stream();
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Stream did not end')), 3000);
      stream.on('data', (chunk: any) => chunks.push(chunk.toString()));
      stream.on('error', reject);
      stream.on('end', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    assert.deepEqual(chunks, ['hello']);
    const { Hono } = await import('../example/node_modules/hono/dist/index.js');
    const app = new Hono().get('/', (context: any) => context.text('Hello from Hono'));
    const beforeServe = XMLHttpRequest.requests;
    const serve = nativeModule('@hono/node-server', 'namespace', 'example/src/entry.ts', ['serve']);
    let server: any;
    const listening = new Promise<number>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info: { port: number }) => resolve(info.port));
    });
    assert.equal(
      XMLHttpRequest.requests - beforeServe,
      2,
      'native-dependent export loads and starts in two operations',
    );
    const honoPort = await listening;
    assert.equal(
      await (await originalFetch(`http://127.0.0.1:${honoPort}/`)).text(),
      'Hello from Hono',
    );
    await new Promise<void>((resolve, reject) =>
      server.close((error?: Error) => (error ? reject(error) : resolve())),
    );
    const available = createServer();
    available.listen(0, '127.0.0.1');
    await once(available, 'listening');
    const expressPort = (available.address() as { port: number }).port;
    await new Promise<void>((resolve) => available.close(() => resolve()));
    const beforeExpress = XMLHttpRequest.requests;
    XMLHttpRequest.operations = [];
    const express = await compile(
      `import express from 'express';
       const app=express();
       app.get('/',(_request,response)=>response.send('Hello from Express'));
       export const server=app.listen(${expressPort},()=>{});`,
      'example/src/entry.ts',
    );
    assert.deepEqual(
      XMLHttpRequest.operations.filter((operation) => operation !== 'callback-result'),
      ['moduleBindings', 'apply', 'applyMember', 'applyMember'],
      'the application performs one load, one factory call and two atomic method calls',
    );
    assert.equal(
      XMLHttpRequest.requests - beforeExpress,
      8,
      'Express adds four callback-reflection replies while preserving live reference semantics',
    );
    assert.equal(
      await (await originalFetch(`http://127.0.0.1:${expressPort}/`)).text(),
      'Hello from Express',
    );
    await new Promise<void>((resolve) => invokeMember(express.server, 'close', resolve));
    const pending = Promise.resolve(runtime.forever());
    await new Promise((resolve) => setTimeout(resolve, 10));
    lumiana.disconnect();
    await assert.rejects(pending, /disconnected/);
    assert.throws(() => counter.value, /disconnected/);
    assert.equal(await connect.credentials(creds), lumiana);
    assert.equal(node('./test/fixtures/runtime.cjs').identity().count, 1);
    lumiana.disconnect();
  } finally {
    globalThis.fetch = originalFetch;
    child.send('close');
    await once(child, 'exit');
  }
});
