import { EventEmitter } from 'events';

const scope = globalThis as any;
const environment = new Map<any, any>();

export const isMainThread = true;
export const threadId = 0;
export const workerData = null;
export const parentPort = null;
export const resourceLimits = Object.freeze({});
export const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

export const MessageChannel = scope.MessageChannel;
export const MessagePort = scope.MessagePort;
export const BroadcastChannel = scope.BroadcastChannel;

export function setEnvironmentData(key: any, value: any): void {
  environment.set(key, structuredClone(value));
}

export function getEnvironmentData(key: any): any {
  const value = environment.get(key);
  return value === undefined ? undefined : structuredClone(value);
}

/** A Node-shaped owner for a browser Worker; its JavaScript remains in the browser. */
export class Worker extends EventEmitter {
  private worker: globalThis.Worker;
  private exitCode?: number;
  readonly threadId = 1;
  readonly resourceLimits = resourceLimits;

  constructor(filename: string | URL, options: any = {}) {
    super();
    if (!scope.Worker) throw new Error('This browser does not support Worker');
    if (options.eval)
      throw new TypeError('worker_threads eval code has no browser module identity');
    this.worker = new scope.Worker(filename, {
      name: options.name,
      type: options.type ?? 'module',
      credentials: options.credentials,
    });
    this.worker.addEventListener('message', (event: MessageEvent) =>
      this.emit('message', event.data),
    );
    this.worker.addEventListener('messageerror', (event: MessageEvent) =>
      this.emit('messageerror', event.data),
    );
    this.worker.addEventListener('error', (event: ErrorEvent) => this.emit('error', event.error));
    queueMicrotask(() => this.emit('online'));
  }

  postMessage(value: any, transferList?: Transferable[]): void {
    this.worker.postMessage(value, transferList ?? []);
  }

  postMessageToThread(value: any, transferList?: Transferable[]): void {
    this.postMessage(value, transferList);
  }

  async terminate(): Promise<number> {
    if (this.exitCode !== undefined) return this.exitCode;
    this.exitCode = 1;
    this.worker.terminate();
    this.emit('exit', this.exitCode);
    return this.exitCode;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export function receiveMessageOnPort(): never {
  throw new TypeError('Synchronous MessagePort reads cannot execute on the browser main thread');
}

export function moveMessagePortToContext(): never {
  throw new TypeError('Browser MessagePorts cannot move into a Node vm context');
}

export function markAsUntransferable(): void {}
export function markAsUncloneable(): void {}
export const isMarkedAsUntransferable = () => false;

export default {
  BroadcastChannel,
  getEnvironmentData,
  isMainThread,
  isMarkedAsUntransferable,
  markAsUncloneable,
  markAsUntransferable,
  MessageChannel,
  MessagePort,
  moveMessagePortToContext,
  parentPort,
  receiveMessageOnPort,
  resourceLimits,
  setEnvironmentData,
  SHARE_ENV,
  threadId,
  Worker,
  workerData,
};
