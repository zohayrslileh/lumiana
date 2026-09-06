import { lumiana, connect } from 'lumiana/client';
const output = document.querySelector('#result')!;
const checks: string[] = [];
const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(name);
  checks.push(name);
  output.textContent = JSON.stringify({ success: false, checks }, null, 2);
};
const nativeFetch = window.fetch,
  nativeSocket = window.WebSocket;
try {
  const processModule = await import('node:process');
  const bufferModule = await import('node:buffer');
  const alias = global;
  const key = 'process';
  check(
    'global and globalThis identify the browser realm',
    alias === globalThis && alias.global === alias,
  );
  check('global process is the local Node process', alias[key] === processModule.default);
  check('global Buffer is the local Node Buffer', alias.Buffer === bufferModule.Buffer);
  check(
    'global timer capabilities are callable',
    typeof alias.setImmediate === 'function' && typeof alias.clearImmediate === 'function',
  );
  check('global browser methods retain their receiver', alias.atob('b2s=') === 'ok');
  let threw = false;
  const fs = await import('node:fs/promises');
  try {
    await fs.readFile('/not-connected');
  } catch {
    threw = true;
  }
  check('use before connection throws', threw);
  check(
    'connection activates the existing singleton',
    (await connect.credentials({ username: 'lumiana', password: 'lumiana' })) === lumiana,
  );
  check(
    'repeated credentials return the singleton',
    (await connect.credentials({ username: 'lumiana', password: 'lumiana' })) === lumiana,
  );
  const task = await lumiana.run(async (value: number) => {
    const { threadId } = await import('node:worker_threads');
    return {
      value: value * 2,
      threadId,
      browserAPIs: [typeof window, typeof document, typeof fetch, typeof WebSocket],
      binary: Buffer.from([0, 128, 255]),
    };
  }, 21);
  check(
    'run executes a copied task in an isolated worker',
    task.value === 42 &&
      task.threadId > 0 &&
      task.browserAPIs.every((value: string) => value === 'undefined') &&
      task.binary instanceof Uint8Array &&
      task.binary.join(',') === '0,128,255',
  );
  const taskStream = await lumiana.run(function* () {
    yield new Uint8Array([1, 2]);
    yield new Uint8Array([3, 4]);
    return 5;
  });
  const streamed: number[] = [];
  for (;;) {
    const item = await taskStream.next();
    if (item.done) {
      streamed.push(item.value);
      break;
    }
    streamed.push(...item.value);
  }
  check('run streams generator output in order', streamed.join(',') === '1,2,3,4,5');
  const binary = new Uint8Array(200_000).map((_, i) => i % 256);
  const os = await import('node:os'),
    path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-binary-'));
  try {
    const file = path.join(dir, 'data.bin');
    await fs.writeFile(file, binary);
    const result = await fs.readFile(file);
    check(
      'asynchronous binary response',
      result.length === binary.length &&
        result.every((byte: number, i: number) => byte === binary[i]),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  const http = await import('node:http');
  const server = http.createServer((request: any, response: any) =>
    response.end(request.headers['user-agent']),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    check('cross-origin fetch uses native networking', /node|undici/.test(await response.text()));
    check('same-origin fetch stays in browser', (await fetch('/')).url === location.origin + '/');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  check(
    'explicit window networking remains untouched',
    window.fetch === nativeFetch && window.WebSocket === nativeSocket,
  );
  const status = await lumiana.status();
  check('status describes the main server', status.pid > 0 && status.connections >= 1);
  lumiana.disconnect();
  let disconnected = false;
  try {
    await lumiana.status();
  } catch {
    disconnected = true;
  }
  check('disconnect invalidates host capabilities', disconnected);
  check(
    'reconnection returns the same browser instance',
    (await connect.credentials({ username: 'lumiana', password: 'lumiana' })) === lumiana,
  );
  lumiana.disconnect();
  output.textContent = JSON.stringify({ success: true, checks }, null, 2);
} catch (error) {
  output.textContent = JSON.stringify(
    { success: false, checks, error: error instanceof Error ? error.stack : String(error) },
    null,
    2,
  );
}
