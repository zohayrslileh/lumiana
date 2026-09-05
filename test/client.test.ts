import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { transformSource } from '../src/build.js';
class XMLHttpRequest {
  static requests = 0;
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
  const { lumiana, connect, node, hybridFetch, HybridWebSocket, importNode, nativeModule } =
    await import('../dist/client.js');
  const creds = { username: 'test', password: 'secret', url };
  const compile = async (source: string) => {
    const result = await transformSource(source, 'reader.js', {
      place: async () => ({ native: true }),
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
