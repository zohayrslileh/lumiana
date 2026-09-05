import type { KernelCall } from './filesystem.js';
import { packKernel, packKernelList, unpackKernel } from '../kernel-transfer.js';

interface KernelBridge {
  owner: object;
  call: KernelCall;
  callSync: (operation: string, ...args: any[]) => any;
  callNativeSync: (specifier: string, path: any, args: any, origin?: string) => any;
  constructNativeSync: (specifier: string, path: any, args: any, origin?: string) => any;
  load: (specifier: string, origin?: string, path?: string[]) => any;
  listeners: Map<number, Set<(event: string, args: any[]) => void>>;
}

const key = Symbol.for('lumiana.kernel');
const scope = globalThis as any;

export function installKernel(
  owner: object,
  call: KernelCall,
  callSync: KernelBridge['callSync'],
  callNativeSync: KernelBridge['callNativeSync'],
  constructNativeSync: KernelBridge['constructNativeSync'],
  load: KernelBridge['load'],
): void {
  scope[key] = {
    owner,
    call,
    callSync,
    callNativeSync,
    constructNativeSync,
    load,
    listeners: new Map(),
  } satisfies KernelBridge;
}

/** Invoke one native module operation without exposing its module object. */
export function nativeCallSync(
  specifier: string,
  path: string[],
  args: any[],
  origin?: string,
): any {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge) throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return bridge.callNativeSync(
    specifier,
    packKernelList(path) as unknown as string[],
    packKernelList(args),
    origin,
  );
}

/** Construct one native module export without exposing its module object. */
export function nativeConstructSync(
  specifier: string,
  path: string[],
  args: any[],
  origin?: string,
): any {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge) throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return bridge.constructNativeSync(
    specifier,
    packKernelList(path) as unknown as string[],
    packKernelList(args),
    origin,
  );
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
  return bridge.call(operation, ...args.map((value) => packKernel(value))).then(unpackKernel);
}

/** Execute a contract that is synchronous in Node with one boundary crossing. */
export function kernelCallSync(operation: string, ...args: any[]): any {
  const bridge = scope[key] as KernelBridge | undefined;
  if (!bridge) throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return unpackKernel(bridge.callSync(operation, ...args.map((value) => packKernel(value))));
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
