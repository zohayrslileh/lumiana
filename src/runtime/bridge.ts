import type { KernelCall } from './filesystem.js';

interface KernelBridge {
  owner: object;
  call: KernelCall;
  load: (specifier: string, origin?: string, path?: string[]) => any;
  listeners: Map<number, Set<(event: string, args: any[]) => void>>;
}

const key = Symbol.for('lumiana.kernel');
const scope = globalThis as any;

export function installKernel(owner: object, call: KernelCall, load: KernelBridge['load']): void {
  scope[key] = { owner, call, load, listeners: new Map() } satisfies KernelBridge;
}

export function nativeRequire(specifier: string, origin?: string, path?: string[]): any {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge) throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return bridge.load(specifier, origin, path);
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
