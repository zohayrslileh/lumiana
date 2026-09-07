import processShim from 'process/browser';

export interface ProcessSnapshot {
  env: Record<string, string>;
  argv: string[];
  execArgv: string[];
  execPath: string;
  platform: string;
  arch: string;
  version: string;
  versions: Record<string, string>;
  pid: number;
  cwd: string;
}

interface ProcessState {
  runtime: typeof processShim & Record<string, any>;
  env: Record<string, string>;
  directory: string;
  listeners?: Set<() => void>;
}

const key = Symbol.for('lumiana.process');
const scope = globalThis as typeof globalThis & { [key]: ProcessState };
const state: ProcessState = (scope[key] ??= {
  runtime: processShim as typeof processShim & Record<string, any>,
  env: Object.create(null),
  directory: '/',
});
const { runtime, env } = state;
const listeners = (state.listeners ??= new Set());

let nativeProcess: any;
const nativeReference = (key: 'stdin' | 'stdout' | 'stderr') => {
  const bound = new WeakMap<object, Map<PropertyKey, Function>>();
  const resolve = () => {
    if (!nativeProcess) {
      const load = (globalThis as any)[Symbol.for('lumiana.runtime')]?.nativeAddon;
      if (typeof load !== 'function') throw new Error('Lumiana is not connected');
      nativeProcess = load('node:process');
    }
    return nativeProcess[key];
  };
  return new Proxy(Object.create(null), {
    get(_target, property) {
      const value = resolve();
      const member = Reflect.get(value, property, value);
      if (typeof member !== 'function') return member;
      let methods = bound.get(value);
      if (!methods) bound.set(value, (methods = new Map()));
      let method = methods.get(property);
      if (!method) methods.set(property, (method = member.bind(value)));
      return method;
    },
    set(_target, property, value) {
      const reference = resolve();
      return Reflect.set(reference, property, value, reference);
    },
    has(_target, property) {
      return property in resolve();
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
      return descriptor && { ...descriptor, configurable: true };
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve());
    },
  });
};

export const stdin = nativeReference('stdin');
export const stdout = nativeReference('stdout');
export const stderr = nativeReference('stderr');

Object.assign(runtime, { stdin, stdout, stderr });

/** Keep local platform-dependent bindings in sync with connection metadata. */
export function observeProcess(listener: () => void): void {
  listeners.add(listener);
  listener();
}

if (runtime.env !== env) {
  Object.defineProperty(runtime, 'env', {
    configurable: false,
    enumerable: true,
    value: env,
  });
  runtime.cwd = () => state.directory;
}

/** Replace connection-owned process state without changing object identity. */
export function initializeProcess(snapshot: ProcessSnapshot): void {
  nativeProcess = undefined;
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, snapshot.env);
  state.directory = snapshot.cwd;
  for (const key of [
    'argv',
    'execArgv',
    'execPath',
    'platform',
    'arch',
    'version',
    'versions',
    'pid',
  ] as const)
    Object.defineProperty(runtime, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: snapshot[key],
    });
  for (const listener of listeners) listener();
}

export default runtime;
