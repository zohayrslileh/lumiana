import { parentPort, workerData, receiveMessageOnPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as resolveImport } from 'import-meta-resolve';
import { References } from './references.js';
import { failure, restoreException, type Invocation, type Graph } from './protocol.js';
if (!parentPort) throw new Error('Lumiana requires a worker thread');
const port = parentPort;
const signal = new Int32Array(workerData.signal);
const parentURL = pathToFileURL(path.join(workerData.root, 'package.json')).href;
const require = createRequire(parentURL);
const modules = new Map<string, any>();
let sequence = 0,
  pumping = 0;
let context: number | undefined;
const replies = new Map<number, any>();
let holdingTurn: number | undefined;
const send = (message: any) => port.postMessage(message);
function pump(until: () => boolean): void {
  pumping++;
  try {
    while (!until()) {
      const version = Atomics.load(signal, 0);
      const incoming = receiveMessageOnPort(port);
      if (incoming) handle(incoming.message);
      else Atomics.wait(signal, 0, version);
    }
  } finally {
    pumping--;
  }
}
const pending = new Map<number, { resolve: (v: Graph) => void; reject: (e: Error) => void }>();
const refs = new References({
  sync(invocation) {
    const id = ++sequence;
    send({ type: 'callback', id, context, invocation });
    pump(() => replies.has(id));
    const reply = replies.get(id);
    replies.delete(id);
    if (!reply.ok) throw restoreException(reply.error, (value) => refs.decode(value));
    return reply.value;
  },
  async(invocation) {
    const id = ++sequence;
    return new Promise<Graph>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ type: 'callback', id, invocation, async: true });
    });
  },
  special(operation, args) {
    if (operation === 'module') {
      const resolver = args[2] ? createRequire(path.resolve(workerData.root, args[2])) : require;
      const loaded = resolver(args[0]);
      if (args[1] === 'default' && loaded?.__esModule) return loaded.default;
      return loaded;
    }
    if (operation === 'global') return (globalThis as any)[args[0]];
    throw new TypeError(`Unknown operation ${operation}`);
  },
});
const exception = (error: unknown) =>
  error instanceof Error ? failure(error) : { ...failure(error), thrown: refs.encode(error) };
function handle(message: any): void {
  if (message.type === 'close') {
    refs.close();
    process.exit(0);
  }
  if (message.type === 'turn-end') {
    if (holdingTurn === message.turn) holdingTurn = undefined;
    return;
  }
  if (message.type === 'callback-result') {
    const promise = pending.get(message.id);
    if (promise) {
      pending.delete(message.id);
      message.ok
        ? promise.resolve(message.value)
        : promise.reject(restoreException(message.error, (value) => refs.decode(value)));
    } else replies.set(message.id, message);
    return;
  }
  if (message.type !== 'invoke') return;
  if (message.invocation.operation === 'await') {
    Promise.resolve(refs.decode(message.invocation.args[0])).then(
      (value) => send({ type: 'result', id: message.id, ok: true, value: refs.encode(value) }),
      (error) => send({ type: 'result', id: message.id, ok: false, error: exception(error) }),
    );
    return;
  }
  const finish = (ok: boolean, value: any) => {
    send(
      ok
        ? { type: 'result', id: message.id, ok: true, value }
        : { type: 'result', id: message.id, ok: false, error: exception(value) },
    );
    // Hold the caller's turn without releasing native nextTick or timers.
    if (message.sync && !pumping && message.turn !== undefined) {
      holdingTurn = message.turn;
      pump(() => holdingTurn !== message.turn);
    }
  };
  if (message.invocation.operation === 'module') {
    const [specifier, mode, origin] = message.invocation.args.map((arg: Graph) => refs.decode(arg));
    if (mode === 'namespace' || mode === 'default') {
      const from = origin ? pathToFileURL(path.resolve(workerData.root, origin)).href : parentURL;
      const key = from + '\0' + specifier + '\0' + mode;
      try {
        if (modules.has(key)) {
          finish(true, refs.encodeResult(modules.get(key), message.invocation.path, true));
          return;
        }
        const resolved = resolveImport(specifier, from);
        if (message.sync) {
          const loaded = require(resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved);
          const isESM = Object.prototype.toString.call(loaded) === '[object Module]';
          if (mode === 'default' && isESM && !('default' in loaded))
            throw new SyntaxError(`Module ${specifier} has no default export`);
          const namespace = isESM
            ? loaded
            : Object.assign(Object.create(null), loaded, { default: loaded });
          const value = mode === 'default' ? namespace.default : namespace;
          modules.set(key, value);
          finish(true, refs.encodeResult(value, message.invocation.path, true));
          return;
        }
        void import(resolved)
          .then((namespace) => {
            if (mode === 'default' && !('default' in namespace))
              throw new SyntaxError(`Module ${specifier} has no default export`);
            const value = mode === 'default' ? namespace.default : namespace;
            modules.set(key, value);
            finish(true, refs.encodeResult(value, message.invocation.path, true));
          })
          .catch((error) => finish(false, error));
      } catch (error) {
        finish(false, error);
      }
      return;
    }
  }
  const before = context;
  context = message.sync ? message.id : undefined;
  let value: any,
    ok = true;
  try {
    value = refs.execute(message.invocation);
  } catch (error) {
    ok = false;
    value = error;
  } finally {
    context = before;
  }
  finish(ok, value);
}
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
  console[level] = (...args: unknown[]) =>
    send({
      type: 'console',
      level,
      context,
      values: args.map((v) => refs.encode(v)),
      errors: args.map((v) => (v instanceof Error ? failure(v) : null)),
    });
}
function fatal(error: unknown): void {
  send({ type: 'fatal', error: exception(error) });
  process.exitCode = 1;
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
port.on('message', handle);
send({ type: 'ready' });
