import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { resolve as resolveImport } from 'import-meta-resolve';
import { failure } from './protocol.js';
import { decodeValue, encodeException, encodeValue } from './values.js';

if (!parentPort) throw new Error('A Lumiana task requires a worker thread');
const port = parentPort;

const descriptor = workerData.task as { code: string; filename: string };
const filename = descriptor.filename.startsWith('file:')
  ? fileURLToPath(descriptor.filename)
  : path.resolve(workerData.root, descriptor.filename || 'lumiana.run.js');
const require = createRequire(filename);
const loadModule = new Function(
  'specifier',
  'attributes',
  'return import(specifier, attributes ? { with: attributes } : undefined)',
) as (specifier: string, attributes?: Record<string, string>) => Promise<any>;
const module = { exports: {} as any };
const taskConsole: Record<string, (...values: unknown[]) => void> = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const)
  taskConsole[level] = (...values: unknown[]) =>
    port.postMessage({
      type: 'console',
      level,
      values: values.map((value) => {
        try {
          return encodeValue(value);
        } catch {
          return encodeValue(String(value));
        }
      }),
      errors: values.map((value) =>
        value instanceof Error ||
        (typeof value === 'object' &&
          value !== null &&
          Object.prototype.toString.call(value) === '[object Error]')
          ? failure(value)
          : null,
      ),
    });

const sandbox: Record<string, any> = {
  Buffer,
  console: taskConsole,
  process,
  module,
  exports: module.exports,
  require,
  __filename: filename,
  __dirname: path.dirname(filename),
};
sandbox.global = sandbox;
const context = vm.createContext(sandbox, { name: `lumiana.run:${filename}` });

let credit = 0;
let cancelled = false;
let wake: (() => void) | undefined;
const waitForCredit = () =>
  credit > 0 || cancelled
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        wake = resolve;
      });
const finish = () => port.close();

port.on('message', (message: any) => {
  if (message.type === 'credit') {
    credit += Math.max(0, Number(message.count) || 0);
    wake?.();
    wake = undefined;
  } else if (message.type === 'cancel') {
    cancelled = true;
    wake?.();
    wake = undefined;
  }
});

async function stream(value: any): Promise<void> {
  const source: any = value;
  const asynchronous = typeof value?.[Symbol.asyncIterator] === 'function';
  const active: AsyncIterator<any> | Iterator<any> = asynchronous
    ? source[Symbol.asyncIterator]()
    : source[Symbol.iterator]();
  port.postMessage({ type: 'stream' });
  for (;;) {
    await waitForCredit();
    if (cancelled) {
      await active.return?.();
      finish();
      return;
    }
    credit--;
    const next = await active.next();
    const output = asynchronous ? next.value : await next.value;
    if (next.done) {
      port.postMessage({ type: 'return', value: encodeValue(output) });
      finish();
      return;
    }
    port.postMessage({ type: 'yield', value: encodeValue(output) });
  }
}

async function execute(): Promise<void> {
  try {
    new vm.Script(descriptor.code, {
      filename,
      importModuleDynamically: async (specifier, _script, attributes) => {
        const resolved = resolveImport(specifier, pathToFileURL(filename).href);
        const values = Object.fromEntries(
          Object.entries(attributes).filter((entry): entry is [string, string] => !!entry[1]),
        );
        return loadModule(resolved, Object.keys(values).length ? values : undefined);
      },
    }).runInContext(context);
    if (typeof module.exports !== 'function')
      throw new TypeError('lumiana.run() requires a function');
    const args = (workerData.args as any[]).map(decodeValue);
    const value: any = await Reflect.apply(module.exports, undefined, args);
    if (
      value &&
      typeof value.next === 'function' &&
      (typeof value[Symbol.asyncIterator] === 'function' ||
        typeof value[Symbol.iterator] === 'function')
    )
      await stream(value);
    else {
      port.postMessage({ type: 'result', value: encodeValue(value) });
      finish();
    }
  } catch (error) {
    port.postMessage({ type: 'error', error: encodeException(error) });
    finish();
  }
}

void execute();
