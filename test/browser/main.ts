import { lumiana, connect, node } from 'lumiana/client';
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
  let threw = false;
  try {
    node('node:fs');
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
  const runtime = node('../fixtures/runtime.cjs');
  const instance = new runtime.Counter(7);
  check(
    'native constructor, identity and method receiver',
    instance.add(1) === instance && instance.value === 8,
  );
  check('nested synchronous callback', runtime.callback((n: number) => n + instance.value) === 50);
  check(
    'native sort calls a synchronous browser comparator',
    [...runtime.sort((a: number, b: number) => a - b)].join(',') === '1,2,3',
  );
  const binary = new Uint8Array(200_000).map((_, i) => i % 256),
    echo = runtime.echo(binary);
  check(
    'compressed synchronous binary response',
    echo.length === binary.length && echo.every((byte: number, i: number) => byte === binary[i]),
  );
  const fs = node('node:fs/promises'),
    os = node('node:os'),
    path = node('node:path');
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
  check(
    'native queued event after listener registration',
    (await new Promise((resolve) => {
      const emitter = runtime.create();
      emitter.once('ready', resolve);
    })) === 42,
  );
  const http = node('node:http');
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
  const thread = node('node:worker_threads').threadId;
  lumiana.disconnect();
  let stale = false;
  try {
    instance.value;
  } catch {
    stale = true;
  }
  check('disconnect invalidates references', stale);
  await connect.credentials({ username: 'lumiana', password: 'lumiana' });
  check('reconnection creates a new worker', node('node:worker_threads').threadId !== thread);
  lumiana.disconnect();
  output.textContent = JSON.stringify({ success: true, checks }, null, 2);
} catch (error) {
  output.textContent = JSON.stringify(
    { success: false, checks, error: error instanceof Error ? error.stack : String(error) },
    null,
    2,
  );
}
