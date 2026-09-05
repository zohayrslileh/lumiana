import { kernelCallSync } from './bridge.js';

export interface OSSnapshot {
  arch: string;
  availableParallelism: number;
  constants: Record<string, any>;
  cpus: any[];
  devNull: string;
  endianness: string;
  EOL: string;
  homedir: string;
  hostname: string;
  machine: string;
  networkInterfaces: Record<string, any>;
  platform: string;
  release: string;
  tmpdir: string;
  totalmem: number;
  type: string;
  uptime: number;
  userInfo: Record<string, any>;
  version: string;
}

interface OSState {
  snapshot?: OSSnapshot;
  connectedAt: number;
  constants: Record<string, any>;
}

const key = Symbol.for('lumiana.os');
const scope = globalThis as any;
const state: OSState = (scope[key] ??= {
  connectedAt: 0,
  constants: Object.create(null),
});

const snapshot = () => {
  if (!state.snapshot)
    throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return state.snapshot;
};
const copy = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, copy(item)])) as T;
  return value;
};
const value =
  <K extends keyof OSSnapshot>(name: K) =>
  () =>
    copy(snapshot()[name]);
const live =
  (name: string) =>
  (...args: any[]) =>
    kernelCallSync(`os.${name}`, ...args);

export let EOL = '\n';
export let devNull = '/dev/null';
export const constants = state.constants;

export function initializeOS(value: OSSnapshot): void {
  state.snapshot = value;
  state.connectedAt = performance.now();
  EOL = value.EOL;
  devNull = value.devNull;
  for (const name of Object.keys(constants)) delete constants[name];
  Object.assign(constants, copy(value.constants));
}

export function clearOS(): void {
  state.snapshot = undefined;
  for (const name of Object.keys(constants)) delete constants[name];
}

export const arch = value('arch');
export const availableParallelism = value('availableParallelism');
export const cpus = value('cpus');
export const endianness = value('endianness');
export const homedir = value('homedir');
export const hostname = value('hostname');
export const machine = value('machine');
export const networkInterfaces = value('networkInterfaces');
export const platform = value('platform');
export const release = value('release');
export const tmpdir = value('tmpdir');
export const totalmem = value('totalmem');
export const type = value('type');
export const userInfo = value('userInfo');
export const version = value('version');
export const uptime = () => snapshot().uptime + (performance.now() - state.connectedAt) / 1000;

// These values describe live host state or mutate host process state.
export const freemem = live('freemem');
export const getPriority = live('getPriority');
export const loadavg = live('loadavg');
export const setPriority = live('setPriority');

const runtime = {
  arch,
  availableParallelism,
  constants,
  cpus,
  get devNull() {
    return devNull;
  },
  endianness,
  get EOL() {
    return EOL;
  },
  freemem,
  getPriority,
  homedir,
  hostname,
  loadavg,
  machine,
  networkInterfaces,
  platform,
  release,
  setPriority,
  tmpdir,
  totalmem,
  type,
  uptime,
  userInfo,
  version,
};

export default runtime;
