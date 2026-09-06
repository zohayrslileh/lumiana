import { parentPort, workerData, receiveMessageOnPort } from 'node:worker_threads';
import { failure } from './protocol.js';
import { decodeException, decodeValue, encodeException, encodeValue } from './values.js';
import { FileKernel } from './kernel/files.js';
import { NetworkKernel } from './kernel/network.js';
import { HttpKernel } from './kernel/http.js';
import { SystemKernel } from './kernel/system.js';
import { ChildProcessKernel } from './kernel/child-process.js';
import { AddonKernel } from './kernel/addons.js';

if (!parentPort) throw new Error('Lumiana requires a worker thread');
const port = parentPort;
const signal = new Int32Array(workerData.signal);
const send = (message: any) => port.postMessage(message);

let sequence = 0;
const allocateHandle = () => ++sequence;
let callbackSequence = 0;
let context: number | undefined;
const replies = new Map<number, any>();

function pump(until: () => boolean): void {
  while (!until()) {
    const version = Atomics.load(signal, 0);
    const incoming = receiveMessageOnPort(port);
    if (incoming) handle(incoming.message);
    else Atomics.wait(signal, 0, version);
  }
}

function invokeCallback(id: number, receiver: any, args: any[]): any {
  const request = ++callbackSequence;
  send({
    type: 'addon-callback',
    id: request,
    callback: id,
    context,
    receiver: encodeValue(receiver),
    args: encodeValue(args),
  });
  pump(() => replies.has(request));
  const reply = replies.get(request);
  replies.delete(request);
  if (!reply.ok) throw decodeException(reply.error);
  return decodeValue(reply.value);
}
const kernelEvent = (handle: number, event: string, ...args: any[]) =>
  send({ type: 'kernel-event', handle, event, value: encodeValue(args) });

const files = new FileKernel(kernelEvent, allocateHandle);
const network = new NetworkKernel(kernelEvent, allocateHandle);
const http = new HttpKernel(kernelEvent, allocateHandle, network);
const system = new SystemKernel();
const children = new ChildProcessKernel(kernelEvent, allocateHandle);
const addons = new AddonKernel(workerData.root, allocateHandle, invokeCallback);

const decodeArguments = (values: any[]) => values.map((value) => decodeValue(value));
const result = (id: number, value: any) =>
  send({ type: 'result', id, ok: true, value: encodeValue(value) });
const reject = (id: number, error: unknown) =>
  send({ type: 'result', id, ok: false, error: encodeException(error) });

async function close(): Promise<void> {
  await Promise.all([files.close(), network.close(), http.close(), children.close()]);
  addons.close();
  process.exit(0);
}

function handle(message: any): void {
  if (message.type === 'close') {
    void close();
    return;
  }
  if (message.type === 'addon-callback-result') {
    replies.set(message.id, message);
    return;
  }
  if (message.type !== 'invoke') return;
  const invocation = message.invocation;
  try {
    const [operation, ...args] = decodeArguments(invocation.args);
    if (invocation.operation === 'kernel') {
      const kernel = operation.startsWith('fs.')
        ? files
        : operation.startsWith('addon.')
          ? addons
          : operation.startsWith('net.') ||
              operation.startsWith('fetch.') ||
              operation.startsWith('websocket.')
            ? network
            : operation.startsWith('child.')
              ? children
              : http;
      void kernel.execute(operation, args).then(
        (value) => result(message.id, value),
        (error) => reject(message.id, error),
      );
      return;
    }
    if (invocation.operation === 'kernelSync') {
      const previous = context;
      context = message.id;
      let value: any;
      try {
        value = operation.startsWith('fs.')
          ? files.executeSync(operation, args)
          : operation.startsWith('addon.')
            ? addons.executeSync(operation, args)
            : operation.startsWith('os.') ||
                operation.startsWith('child.') ||
                operation.startsWith('system.')
              ? system.executeSync(operation, args)
              : (() => {
                  throw new TypeError(`Unknown synchronous operation ${operation}`);
                })();
      } finally {
        context = previous;
      }
      result(message.id, value);
      return;
    }
    throw new TypeError(`Unknown boundary operation ${invocation.operation}`);
  } catch (error) {
    reject(message.id, error);
  }
}

port.on('message', handle);

for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
  console[level] = (...args: unknown[]) => {
    const values = args.map((value) => {
      try {
        return encodeValue(value);
      } catch {
        return encodeValue(String(value));
      }
    });
    send({
      type: 'console',
      level,
      values,
      errors: args.map((value) => (value instanceof Error ? failure(value) : null)),
    });
  };
}

process.on('uncaughtException', (error) => send({ type: 'fatal', error: failure(error) }));
process.on('unhandledRejection', (error) => send({ type: 'fatal', error: failure(error) }));
send({ type: 'ready' });
