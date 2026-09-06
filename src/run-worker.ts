import { parentPort, workerData } from 'node:worker_threads';
import { decodeValue, encodeException, encodeValue } from './values.js';
import { createWorkerContext } from './worker-context.js';

if (!parentPort) throw new Error('A Lumiana task requires a worker thread');
const port = parentPort;

const descriptor = workerData.task as { code: string; filename: string };
const context = createWorkerContext(descriptor, workerData.root, 'run', (packet) =>
  port.postMessage(packet),
);

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
    const task = context.load();
    if (typeof task !== 'function') throw new TypeError('lumiana.run() requires a function');
    const args = (workerData.args as any[]).map(decodeValue);
    const value: any = await Reflect.apply(task, undefined, args);
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
