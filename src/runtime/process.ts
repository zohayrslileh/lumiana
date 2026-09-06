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
