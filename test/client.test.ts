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
    path: runtime('path'),
    'node:path': runtime('path'),
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
      resolveDir: path.resolve('examples/vanilla'),
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
  const { lumiana, connect } = await import('../dist/client.js');
  const { hybridFetch, HybridWebSocket, moduleDirname, moduleFilename, nativeAddon } =
    await import('../dist/browser.js');
  const browserFs = await import('../dist/runtime/fs-promises.js');
  const browserNodeFs = await import('../dist/runtime/fs.js');
  const browserHttp = await import('../dist/runtime/http.js');
  const browserNet = await import('../dist/runtime/net.js');
  const browserOS = await import('../dist/runtime/os.js');
  const browserChildProcess = await import('../dist/runtime/child-process.js');
  const browserDNS = await import('../dist/runtime/dns.js');
  const browserUtil = await import('../dist/runtime/util.js');
  const creds = { username: 'test', password: 'secret', url };
  const compile = async (source: string, origin = 'reader.js') => {
    const result = await transformSource(source, origin, {
      place: async () => ({}),
      origin,
      client: new URL('../dist/browser.js', import.meta.url).href,
      process: new URL('../dist/runtime/process.js', import.meta.url).href,
    });
    return import(
      'data:text/javascript;base64,' + Buffer.from(result?.code ?? source).toString('base64')
    );
  };
  try {
    const reader = await compile('export const read = (value) => value.child.value;');
    assert.equal(reader.read({ child: { value: 7 } }), 7);
    assert.throws(() => lumiana.status, /not connected/);
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
    assert.equal(
      moduleFilename('node_modules/package/index.cjs'),
      path.resolve('node_modules/package/index.cjs'),
    );
    assert.equal(
      moduleDirname('node_modules/package/index.cjs'),
      path.resolve('node_modules/package'),
    );
    assert.equal((await lumiana.status()).pid, pid);
    const beforeAddon = XMLHttpRequest.requests;
    const addon = nativeAddon('./test/fixtures/addon.cjs');
    assert.equal(XMLHttpRequest.requests - beforeAddon, 1, 'native addon loading is one call');
    const beforeAddonProperties = XMLHttpRequest.requests;
    assert.equal(typeof addon.record, 'function');
    assert.equal(typeof addon.Counter, 'function');
    assert.equal(
      XMLHttpRequest.requests,
      beforeAddonProperties,
      'native addon exports and their prototypes materialize during loading',
    );
    const beforeAddonInvocation = XMLHttpRequest.requests;
    assert.deepEqual(addon.record(), { local: true, values: [1, 2, 3] });
    assert.equal(
      XMLHttpRequest.requests - beforeAddonInvocation,
      1,
      'a native addon method is one operation without reflection calls',
    );
    assert.equal(
      addon.call(20, (value: number) => value + 22),
      42,
    );
    assert.equal(await addon.later(20, async (value: number) => value + 22), 42);
    const counter = new addon.Counter(2);
    assert.equal(counter instanceof addon.Counter, true);
    assert.equal(counter.add(3), 5);
    assert.equal(counter.value, 5, 'mutable native resource data remains live');
    let thrown: unknown;
    try {
      addon.throwValue();
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown, 17);
    try {
      addon.call(1, () => {
        throw 'callback failure';
      });
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown, 'callback failure');
    const beforeOS = XMLHttpRequest.requests;
    assert.equal(browserOS.homedir(), os.homedir());
    assert.equal(browserOS.platform(), os.platform());
    assert.equal(XMLHttpRequest.requests, beforeOS, 'stable OS state is connection-local');
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
      const beforeSync = XMLHttpRequest.requests;
      assert.equal(browserNodeFs.existsSync(kernelFile), true);
      assert.equal(
        XMLHttpRequest.requests - beforeSync,
        1,
        'a synchronous OS decision is one call',
      );
      const syncStat = browserNodeFs.statSync(kernelFile);
      assert.equal(syncStat.isFile(), true);
      assert.equal(
        XMLHttpRequest.requests - beforeSync,
        2,
        'synchronous results retain local behavior without reflection calls',
      );
      const beforeCallback = XMLHttpRequest.requests;
      const callbackValue = await new Promise<Buffer>((resolve, reject) =>
        browserNodeFs.readFile(kernelFile, (error: Error | null, value: Buffer) =>
          error ? reject(error) : resolve(value),
        ),
      );
      assert.deepEqual(callbackValue, Buffer.from([0, 128, 255]));
      assert.equal(
        XMLHttpRequest.requests,
        beforeCallback,
        'callback filesystem operations use the established WebSocket',
      );
      const beforeWatch = XMLHttpRequest.requests;
      const watcher = browserNodeFs.watch(kernelDirectory);
      const changed = once(watcher, 'change');
      await browserFs.writeFile(path.join(kernelDirectory, 'watched.txt'), 'changed');
      const [eventType, filename] = await changed;
      assert.equal(typeof eventType, 'string');
      assert.equal(String(filename), 'watched.txt');
      watcher.close();
      assert.equal(
        XMLHttpRequest.requests,
        beforeWatch,
        'filesystem watchers and events use the established WebSocket',
      );
    } finally {
      await browserFs.rm(kernelDirectory, { recursive: true, force: true });
    }
    const beforeChild = XMLHttpRequest.requests;
    const childOutput: Buffer[] = [];
    const spawned = browserChildProcess.spawn(process.execPath, [
      '-e',
      'process.stdout.write(Buffer.from([0,128,255]))',
    ]);
    spawned.stdout.on('data', (chunk: Buffer) => childOutput.push(chunk));
    await once(spawned, 'close');
    assert.deepEqual(Buffer.concat(childOutput), Buffer.from([0, 128, 255]));
    const execFileAsync = browserUtil.promisify(browserChildProcess.execFile) as any;
    const execution = execFileAsync(process.execPath, [
      '-e',
      "process.stdout.write('promisified');process.stderr.write('stderr')",
    ]);
    assert.equal(execution.child.constructor, browserChildProcess.ChildProcess);
    assert.deepEqual(await execution, { stdout: 'promisified', stderr: 'stderr' });
    const piped = browserChildProcess.spawn(
      process.execPath,
      [
        '-e',
        "const fs=require('fs');const input=fs.createReadStream(null,{fd:3});const output=fs.createWriteStream(null,{fd:4});input.on('data',chunk=>output.write(chunk));input.on('end',()=>output.end())",
      ],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
    );
    const pipeOutput: Buffer[] = [];
    piped.stdio[4].on('data', (chunk: Buffer) => pipeOutput.push(chunk));
    const pipeClosed = once(piped.stdio[4], 'close');
    piped.stdio[3].end(Buffer.from([3, 2, 1]));
    await once(piped.stdio[4], 'end');
    await once(piped, 'close');
    await pipeClosed;
    assert.deepEqual(Buffer.concat(pipeOutput), Buffer.from([3, 2, 1]));
    const address = await browserDNS.promises.lookup('localhost');
    assert.ok(address.family === 4 || address.family === 6);
    assert.equal(
      XMLHttpRequest.requests,
      beforeChild + 3,
      'each spawn crosses synchronously once; lifecycle and binary streams use the WebSocket',
    );
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
    const beforeStringify = XMLHttpRequest.requests;
    const serialized = await compile(
      'export const environment = process.env;export const value = JSON.parse(JSON.stringify(process.env)).HOME;',
    );
    assert.equal(serialized.value, process.env.HOME);
    assert.equal(Object.getPrototypeOf(serialized.environment), null);
    assert.equal(
      XMLHttpRequest.requests - beforeStringify,
      0,
      'the browser-owned environment needs no native reflection',
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
    assert.equal(XMLHttpRequest.requests - beforeHome, 0, 'local process reads need no XHR');
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
    lumiana.disconnect();
    assert.throws(() => browserOS.homedir(), /not connected/);
    assert.equal(await connect.credentials(creds), lumiana);
    lumiana.disconnect();
  } finally {
    globalThis.fetch = originalFetch;
    child.send('close');
    await once(child, 'exit');
  }
});
