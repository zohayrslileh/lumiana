import type { KernelCall } from './filesystem.js';

interface KernelBridge {
  owner: object;
  call: KernelCall;
  callSync: (operation: string, ...args: any[]) => any;
  registerCallback: (callback: Function) => number;
  listeners: Map<number, Set<(event: string, args: any[]) => void>>;
}

const key = Symbol.for('lumiana.kernel');
const scope = globalThis as any;

export function installKernel(
  owner: object,
  call: KernelCall,
  callSync: KernelBridge['callSync'],
  registerCallback: KernelBridge['registerCallback'] = () => {
    throw new Error('Native callback registry is unavailable');
  },
): void {
  scope[key] = {
    owner,
    call,
    callSync,
    registerCallback,
    listeners: new Map(),
  } satisfies KernelBridge;
}

export function removeKernel(owner: object): void {
  if (scope[key]?.owner === owner) delete scope[key];
}

export function kernelCall(operation: string, ...args: any[]): Promise<any> {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge)
    return Promise.reject(
      new Error('Lumiana is not connected. Call await connect.credentials() first.'),
    );
  return bridge.call(operation, ...args);
}

/** Execute a contract that is synchronous in Node with one boundary crossing. */
export function kernelCallSync(operation: string, ...args: any[]): any {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge) throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return bridge.callSync(operation, ...args);
}

export function kernelSubscribe(
  handle: number,
  listener: (event: string, args: any[]) => void,
): () => void {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge) throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  const listeners = bridge.listeners.get(handle) ?? new Set();
  listeners.add(listener);
  bridge.listeners.set(handle, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) bridge.listeners.delete(handle);
  };
}

export function dispatchKernel(handle: number, event: string, args: any[]): void {
  const bridge = scope[key] as KernelBridge | undefined;
  for (const listener of bridge?.listeners.get(handle) ?? []) listener(event, args);
}

/** Retain callback identity in the browser; the engine receives only its reference. */
export function kernelCallback(callback: Function): number {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge) throw new Error('Lumiana is not connected');
  return bridge.registerCallback(callback);
}
