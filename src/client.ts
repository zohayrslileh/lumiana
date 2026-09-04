export interface PingResult {
  readonly ok: boolean;
  readonly latency: number;
  readonly clientTimestamp: number;
  readonly serverTimestamp: number;
  readonly uptime: number;
  readonly mode: 'development' | 'production';
}

export interface LumianaNodeProxy {
  (...args: unknown[]): Promise<any>;
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<any | TResult>;
  finally(onfinally?: (() => void) | null): Promise<any>;
  [prop: string]: any;
}

export interface NodeProcessKnown {
  readonly env: Promise<Record<string, string | undefined>> & Record<string, LumianaNodeProxy>;
  readonly version: Promise<string> & string;
  readonly versions: Promise<Record<string, string>> & Record<string, LumianaNodeProxy>;
  readonly arch: Promise<string> & string;
  readonly platform: Promise<string> & string;
  readonly pid: Promise<number> & number;
  readonly ppid: Promise<number> & number;
  readonly title: Promise<string> & string;
  readonly argv: Promise<string[]> & LumianaNodeProxy;
  readonly execPath: Promise<string> & string;
  cwd(): Promise<string>;
  uptime(): Promise<number>;
  memoryUsage(): Promise<Record<string, number>>;
  cpuUsage(previousValue?: unknown): Promise<Record<string, number>>;
  hrtime(): Promise<[number, number]>;
  exit(code?: number): Promise<never>;
  kill(pid: number, signal?: string | number): Promise<boolean>;
}
export type NodeProcessProxy = NodeProcessKnown & LumianaNodeProxy;

export interface NodeOsKnown {
  platform(): Promise<string>;
  arch(): Promise<string>;
  uptime(): Promise<number>;
  totalmem(): Promise<number>;
  freemem(): Promise<number>;
  cpus(): Promise<Array<{
    model: string;
    speed: number;
    times: { user: number; nice: number; sys: number; idle: number; irq: number };
  }>>;
  homedir(): Promise<string>;
  hostname(): Promise<string>;
  type(): Promise<string>;
  release(): Promise<string>;
  networkInterfaces(): Promise<Record<string, unknown[]>>;
  userInfo(options?: unknown): Promise<Record<string, unknown>>;
  loadavg(): Promise<[number, number, number]>;
  readonly constants: Promise<Record<string, any>> & LumianaNodeProxy;
}
export type NodeOsProxy = NodeOsKnown & LumianaNodeProxy;

export interface NodeFsPromisesKnown {
  readdir(path: string, options?: unknown): Promise<string[]>;
  readFile(path: string, encoding?: string): Promise<string | Uint8Array>;
  writeFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
  stat(path: string): Promise<Record<string, unknown>>;
  unlink(path: string): Promise<void>;
  mkdir(path: string, options?: unknown): Promise<string | undefined>;
  rm(path: string, options?: unknown): Promise<void>;
  access(path: string, mode?: number): Promise<void>;
  copyFile(src: string, dest: string, mode?: number): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  appendFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
  chmod(path: string, mode: string | number): Promise<void>;
  realpath(path: string, options?: unknown): Promise<string>;
}
export type NodeFsPromisesProxy = NodeFsPromisesKnown & LumianaNodeProxy;

export interface NodeFsKnown extends NodeFsPromisesKnown {
  readonly promises: NodeFsPromisesProxy;
  readonly constants: Promise<Record<string, any>> & LumianaNodeProxy;
  exists(path: string): Promise<boolean>;
}
export type NodeFsProxy = NodeFsKnown & LumianaNodeProxy;

export interface NodePathKnown {
  join(...paths: string[]): Promise<string>;
  resolve(...paths: string[]): Promise<string>;
  basename(p: string, ext?: string): Promise<string>;
  dirname(p: string): Promise<string>;
  extname(p: string): Promise<string>;
  normalize(p: string): Promise<string>;
  isAbsolute(p: string): Promise<boolean>;
  relative(from: string, to: string): Promise<string>;
  readonly sep: Promise<string> & string;
  readonly delimiter: Promise<string> & string;
}
export type NodePathProxy = NodePathKnown & LumianaNodeProxy;

export interface NodeCryptoKnown {
  randomUUID(): Promise<string>;
  randomBytes(size: number): Promise<Uint8Array>;
  randomInt(min: number, max?: number): Promise<number>;
}
export type NodeCryptoProxy = NodeCryptoKnown & LumianaNodeProxy;

export interface LumianaKnownModules {
  readonly process: NodeProcessProxy;
  readonly os: NodeOsProxy;
  readonly fs: NodeFsProxy;
  readonly path: NodePathProxy;
  readonly crypto: NodeCryptoProxy;
}

export type LumianaNode = LumianaKnownModules & LumianaNodeProxy;
export type LumianaNodeModules = LumianaNode;

// Backwards compatibility aliases
export type NodeProcess = NodeProcessProxy;
export type NodeOs = NodeOsProxy;
export type NodeFs = NodeFsProxy;
export type NodePath = NodePathProxy;

export interface LumianaRunContext {
  os: {
    platform(): string;
    arch(): string;
    uptime(): number;
    totalmem(): number;
    freemem(): number;
    cpus(): Array<{ model: string; speed: number; times: Record<string, number> }>;
    homedir(): string;
    hostname(): string;
    type(): string;
    release(): string;
    userInfo(options?: unknown): Record<string, unknown>;
    networkInterfaces(): Record<string, unknown[]>;
    constants: Record<string, unknown>;
    [key: string]: unknown;
  };
  fs: {
    readdir(path: string, options?: unknown): Promise<string[]>;
    readFile(path: string, encoding?: string): Promise<string | Uint8Array>;
    writeFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
    stat(path: string): Promise<Record<string, unknown>>;
    unlink(path: string): Promise<void>;
    mkdir(path: string, options?: unknown): Promise<string | undefined>;
    rm(path: string, options?: unknown): Promise<void>;
    copyFile(src: string, dest: string, mode?: number): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    appendFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
    [key: string]: unknown;
  };
  path: {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
    basename(p: string, ext?: string): string;
    dirname(p: string): string;
    extname(p: string): string;
    normalize(p: string): string;
    isAbsolute(p: string): boolean;
    relative(from: string, to: string): string;
    sep: string;
    delimiter: string;
    [key: string]: unknown;
  };
  process: {
    cwd(): string;
    uptime(): number;
    version: string;
    versions: Record<string, string>;
    arch: string;
    platform: string;
    pid: number;
    ppid: number;
    env: Record<string, string | undefined>;
    memoryUsage(): Record<string, number>;
    [key: string]: unknown;
  };
  import<T = unknown>(moduleName: string): Promise<T>;
  [key: string]: unknown;
}

export interface LumianaClient {
  ping(): Promise<PingResult>;
  run<T = unknown>(
    fn: string | (() => Promise<T> | T) | ((ctx: LumianaRunContext, ...args: any[]) => Promise<T> | T),
    ...args: any[]
  ): any;
  readonly node: LumianaNode;
  send(data: Uint8Array): void;
  onMessage(callback: (data: Uint8Array) => void): () => void;
  close(): void;
  readonly ws: WebSocket;
}

export interface Credentials {
  readonly username?: string;
  readonly password?: string;
}

let activeCredentials: Credentials = { username: 'lumiana', password: 'lumiana' };
let activeClientPromise: Promise<LumianaClient> | null = null;

export class LumianaBuffer extends Uint8Array {
  static get [Symbol.species]() {
    return LumianaBuffer;
  }

  override toString(encoding: string = 'utf8'): string {
    const enc = encoding.toLowerCase().replace('-', '');
    if (enc === 'hex') {
      return Array.from(this)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    if (enc === 'base64') {
      let binary = '';
      const len = this.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(this[i]);
      }
      return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(this).toString('base64');
    }
    return new TextDecoder(enc === 'utf8' ? 'utf-8' : encoding).decode(this);
  }

  write(string: string, offset: number = 0, length?: number | string, encoding: string = 'utf8'): number {
    const enc = typeof length === 'string' ? length : encoding;
    const len = typeof length === 'number' ? length : this.length - offset;
    const encoded = new TextEncoder().encode(string);
    const toCopy = Math.min(len, encoded.length, this.length - offset);
    this.set(encoded.subarray(0, toCopy), offset);
    return toCopy;
  }

  copy(target: Uint8Array, targetStart: number = 0, sourceStart: number = 0, sourceEnd?: number): number {
    const end = sourceEnd !== undefined ? sourceEnd : this.length;
    const toCopy = Math.min(end - sourceStart, target.length - targetStart);
    if (toCopy <= 0) return 0;
    target.set(this.subarray(sourceStart, sourceStart + toCopy), targetStart);
    return toCopy;
  }

  equals(other: Uint8Array): boolean {
    if (this.byteLength !== other.byteLength) return false;
    for (let i = 0; i < this.byteLength; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }

  readUInt32BE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, false);
  }

  readUInt32LE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, true);
  }

  readUInt16BE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, false);
  }

  readUInt16LE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, true);
  }

  writeUInt32BE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, val, false);
    return offset + 4;
  }

  writeUInt32LE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, val, true);
    return offset + 4;
  }

  static isBuffer(obj: unknown): boolean {
    return obj instanceof LumianaBuffer || obj instanceof Uint8Array;
  }

  static alloc(size: number, fill?: number | string, encoding: string = 'utf8'): LumianaBuffer {
    const buf = new LumianaBuffer(size);
    if (fill !== undefined) {
      if (typeof fill === 'number') {
        buf.fill(fill);
      } else if (typeof fill === 'string') {
        const fillBuf = LumianaBuffer.from(fill, encoding);
        if (fillBuf.length > 0) {
          for (let i = 0; i < size; i++) {
            buf[i] = fillBuf[i % fillBuf.length];
          }
        }
      }
    }
    return buf;
  }

  static allocUnsafe(size: number): LumianaBuffer {
    return new LumianaBuffer(size);
  }

  static concat(list: Uint8Array[], totalLength?: number): LumianaBuffer {
    let actualLength = 0;
    if (totalLength === undefined) {
      for (const b of list) actualLength += b.length;
    } else {
      actualLength = totalLength;
    }
    const result = new LumianaBuffer(actualLength);
    let offset = 0;
    for (const b of list) {
      if (offset >= actualLength) break;
      const toCopy = Math.min(b.length, actualLength - offset);
      result.set(b.subarray(0, toCopy), offset);
      offset += toCopy;
    }
    return result;
  }

  static override from(str: string, encoding?: string): LumianaBuffer;
  static override from(arrayLike: ArrayLike<number>): LumianaBuffer;
  static override from<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): LumianaBuffer;
  static override from(elements: Iterable<number>): LumianaBuffer;
  static override from<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): LumianaBuffer;
  static override from(data: any, _encodingOrMap?: any, _thisArg?: any): LumianaBuffer {
    if (typeof data === 'string') {
      return new LumianaBuffer(new TextEncoder().encode(data));
    }
    if (data instanceof Uint8Array) {
      return new LumianaBuffer(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    }
    if (Array.isArray(data)) {
      return new LumianaBuffer(data);
    }
    return new LumianaBuffer();
  }
}

export { LumianaBuffer as Buffer };

function getSyncHttpUrl(): string {
  if (typeof location !== 'undefined') {
    return `${location.protocol}//${location.host}/__lumiana_sync_node__`;
  }
  return 'http://localhost:3883/__lumiana_sync_node__';
}

export function syncNodeCall(
  refId: string | null,
  path: string[],
  args: unknown[] | null,
  isCall: boolean = true
): unknown {
  if (typeof XMLHttpRequest === 'undefined') {
    throw new Error('[Lumiana Sync] XMLHttpRequest is not available in this environment.');
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', getSyncHttpUrl(), false); // Synchronous execution!
  xhr.setRequestHeader('Content-Type', 'application/json');

  if (activeCredentials?.username || activeCredentials?.password) {
    const user = activeCredentials.username || '';
    const pass = activeCredentials.password || '';
    const token = typeof btoa !== 'undefined' ? btoa(`${user}:${pass}`) : Buffer.from(`${user}:${pass}`).toString('base64');
    xhr.setRequestHeader('Authorization', `Basic ${token}`);
    xhr.setRequestHeader('x-lumiana-auth', token);
  }

  const marshalledArgs = args !== null ? args.map(marshallValue) : null;
  const payload = JSON.stringify({ refId, path, args: marshalledArgs, isCall });

  try {
    xhr.send(payload);
  } catch (netErr: any) {
    throw new Error(`[Lumiana Sync] Network error connecting to ${getSyncHttpUrl()}: ${netErr?.message || netErr}`);
  }

  if (xhr.status === 401) {
    throw new Error('[Lumiana Sync] Unauthorized: Authentication failed (HTTP 401). Check username and password.');
  }

  if (xhr.status !== 200) {
    throw new Error(`[Lumiana Sync] Call failed with status ${xhr.status}: ${xhr.responseText}`);
  }

  let data: any;
  try {
    data = JSON.parse(xhr.responseText);
  } catch (jsonErr) {
    throw new Error(`[Lumiana Sync] Failed to parse response JSON: ${xhr.responseText}`);
  }

  if (!data.ok) {
    const err = new Error(data.error?.message || data.error || 'Sync Node call failed');
    if (data.error?.code) (err as any).code = data.error.code;
    if (data.error?.stack) err.stack = data.error.stack;
    throw err;
  }

  return unmarshallValue(data.result);
}

function marshallValue(value: unknown): unknown {
  if (typeof value === 'function') {
    return { __lumiana_cb_warn__: 'Callback passed to sync call' };
  }
  if (value instanceof Uint8Array) {
    return { __lumiana_bin__: Array.from(value) };
  }
  if (Array.isArray(value)) {
    return value.map(marshallValue);
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === null || proto === Object.prototype) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        obj[k] = marshallValue(v);
      }
      return obj;
    }
  }
  return value;
}

function wrapStatsObject(obj: Record<string, any>): Record<string, any> {
  if (
    typeof obj.mode === 'number' &&
    typeof obj.size === 'number' &&
    (typeof obj.mtimeMs === 'number' || typeof obj.mtime === 'string' || typeof obj.ino === 'number')
  ) {
    obj.isFile = function () {
      return (this.mode & 0o170000) === 0o100000;
    };
    obj.isDirectory = function () {
      return (this.mode & 0o170000) === 0o040000;
    };
    obj.isSymbolicLink = function () {
      return (this.mode & 0o170000) === 0o120000;
    };
    obj.isBlockDevice = function () {
      return (this.mode & 0o170000) === 0o060000;
    };
    obj.isCharacterDevice = function () {
      return (this.mode & 0o170000) === 0o020000;
    };
    obj.isFIFO = function () {
      return (this.mode & 0o170000) === 0o010000;
    };
    obj.isSocket = function () {
      return (this.mode & 0o170000) === 0o140000;
    };
    if (!obj.mtime && obj.mtimeMs) obj.mtime = new Date(obj.mtimeMs);
    if (!obj.atime && obj.atimeMs) obj.atime = new Date(obj.atimeMs);
    if (!obj.ctime && obj.ctimeMs) obj.ctime = new Date(obj.ctimeMs);
    if (!obj.birthtime && obj.birthtimeMs) obj.birthtime = new Date(obj.birthtimeMs);
  }
  return obj;
}

function unmarshallValue(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'object') {
    if ((data as { __lumiana_ref__?: string }).__lumiana_ref__) {
      return createNodeModuleProxy('ref', [], (data as { __lumiana_ref__: string }).__lumiana_ref__);
    }
    if ((data as { __lumiana_bin__?: number[] }).__lumiana_bin__) {
      return LumianaBuffer.from((data as { __lumiana_bin__: number[] }).__lumiana_bin__);
    }
    if (Array.isArray(data)) {
      return data.map(unmarshallValue);
    }
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      obj[k] = unmarshallValue(v);
    }
    return wrapStatsObject(obj);
  }
  return data;
}

export function createNodeModuleProxy(
  moduleName: string,
  path: string[] = [moduleName],
  refId: string | null = null,
  staticValues: Record<string, unknown> = {}
): any {
  const dummy = function () {};

  return new Proxy(dummy, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        if (prop === Symbol.toStringTag) return `[NodeModule ${moduleName}]`;
        if (prop === Symbol.toPrimitive) return () => `[NodeModule ${moduleName} ${path.join('.')}]`;
        return undefined;
      }

      if (path.length === 1 && prop in staticValues) {
        return staticValues[prop];
      }

      if (prop === 'then') {
        if (path.length === 0) return undefined;
        return (onFulfilled?: (val: any) => any, onRejected?: (err: any) => any) => {
          try {
            const res = syncNodeCall(refId, path, null, false);
            return Promise.resolve(res).then(onFulfilled, onRejected);
          } catch (err) {
            return Promise.reject(err).catch(onRejected);
          }
        };
      }

      if (prop === 'promises') {
        return createNodeModuleProxy(moduleName, [...path, 'promises'], refId, {});
      }

      return createNodeModuleProxy(moduleName, [...path, prop], refId, {});
    },

    apply(_target, _thisArg, args: unknown[]) {
      // If path includes 'promises', return a Promise
      if (path.includes('promises')) {
        return Promise.resolve().then(() => {
          return syncNodeCall(refId, path, args, true);
        });
      }

      // Default: Synchronous execution matching Node behavior!
      return syncNodeCall(refId, path, args, true);
    },
  });
}

interface ServerExecutionResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function getInternalWsUrl(username: string, password: string): string {
  const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof location !== 'undefined' ? location.host : 'localhost:3883';
  return `${proto}//${host}/lumiana-ws?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

function createProcessObject(): any {
  let cachedEnv: Record<string, string> = {};
  try {
    const rawEnv = syncNodeCall(null, ['process', 'env'], null, false);
    if (rawEnv && typeof rawEnv === 'object') {
      cachedEnv = { ...(rawEnv as Record<string, string>) };
    }
  } catch {}

  const envProxy = new Proxy(cachedEnv, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'string') {
        if (prop in target) return target[prop];
        return undefined;
      }
      return undefined;
    },
    set(target, prop: string | symbol, val: any) {
      if (typeof prop === 'string') {
        target[prop] = String(val);
      }
      return true;
    },
    has(target, prop: string | symbol) {
      return typeof prop === 'string' && prop in target;
    },
  });

  const proc: any = {
    env: envProxy,
    version: 'v22.0.0',
    versions: { node: '22.0.0', v8: '12.0', lumiana: '0.2.0' },
    platform: typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? 'darwin' : 'linux',
    arch: 'x64',
    pid: 12345,
    ppid: 1,
    title: 'lumiana',
    argv: ['node', '/app/index.js'],
    execPath: '/usr/local/bin/node',
    cwd: () => {
      try {
        const c = syncNodeCall(null, ['process', 'cwd'], [], true);
        return typeof c === 'string' ? c : '/';
      } catch {
        return '/';
      }
    },
    nextTick: (fn: (...args: any[]) => void, ...args: any[]) => {
      queueMicrotask(() => fn(...args));
    },
    stdout: {
      isTTY: true,
      columns: 80,
      rows: 24,
      write: (chunk: any) => {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        console.log(text);
        return true;
      },
    },
    stderr: {
      isTTY: true,
      columns: 80,
      rows: 24,
      write: (chunk: any) => {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        console.error(text);
        return true;
      },
    },
    stdin: {
      isTTY: false,
      on: () => {},
      once: () => {},
      emit: () => false,
    },
    on: () => {},
    once: () => {},
    emit: () => false,
    removeListener: () => {},
    exit: (code?: number) => {
      console.warn(`[Lumiana] process.exit(${code ?? 0}) called`);
    },
    uptime: () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0),
    hrtime: (prev?: [number, number]) => {
      const ms = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const s = Math.floor(ms / 1000);
      const ns = Math.floor((ms % 1000) * 1e6);
      if (prev) {
        return [s - prev[0], ns - prev[1]];
      }
      return [s, ns];
    },
    memoryUsage: () => ({
      rss: 50 * 1024 * 1024,
      heapTotal: 30 * 1024 * 1024,
      heapUsed: 20 * 1024 * 1024,
      external: 5 * 1024 * 1024,
      arrayBuffers: 2 * 1024 * 1024,
    }),
  };

  return proc;
}

export function setupBrowserEnvironment(): void {
  if (typeof window !== 'undefined') {
    (window as any).global = window;
    (window as any).Buffer = LumianaBuffer;
    (window as any).process = createProcessObject();
    if (typeof (window as any).setImmediate === 'undefined') {
      (window as any).setImmediate = (fn: any, ...args: any[]) => setTimeout(fn, 0, ...args);
      (window as any).clearImmediate = (id: any) => clearTimeout(id);
    }
  } else if (typeof globalThis !== 'undefined') {
    (globalThis as any).global = globalThis;
    (globalThis as any).Buffer = LumianaBuffer;
    (globalThis as any).process = createProcessObject();
  }
}

async function baseConnect(creds?: Credentials): Promise<LumianaClient> {
  if (creds) {
    activeCredentials = creds;
  }
  const username = creds?.username ?? activeCredentials.username ?? '';
  const password = creds?.password ?? activeCredentials.password ?? '';
  const wsUrl = getInternalWsUrl(username, password);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    const listeners = new Set<(data: Uint8Array) => void>();
    const pendingPings = new Map<number, (res: PingResult) => void>();
    const pendingRequests = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
    const localCallbacks = new Map<string, (...args: unknown[]) => unknown>();

    function marshall(value: unknown): unknown {
      if (typeof value === 'function') {
        const cbId = 'cb_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localCallbacks.set(cbId, value as (...args: unknown[]) => unknown);
        return { __lumiana_cb__: cbId };
      }
      if (value instanceof Uint8Array) {
        return { __lumiana_bin__: Array.from(value) };
      }
      if (Array.isArray(value)) {
        return value.map(marshall);
      }
      if (value !== null && typeof value === 'object') {
        const proto = Object.getPrototypeOf(value);
        if (proto === null || proto === Object.prototype) {
          const obj: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(value)) {
            obj[k] = marshall(v);
          }
          return obj;
        }
      }
      return value;
    }

    function unmarshall(data: unknown): unknown {
      if (data === null || data === undefined) return data;
      if (typeof data === 'object') {
        if ((data as { __lumiana_ref__?: string }).__lumiana_ref__) {
          return createNodeProxy([], (data as { __lumiana_ref__: string }).__lumiana_ref__);
        }
        if ((data as { __lumiana_bin__?: number[] }).__lumiana_bin__) {
          return LumianaBuffer.from((data as { __lumiana_bin__: number[] }).__lumiana_bin__);
        }
        if (Array.isArray(data)) {
          return data.map(unmarshall);
        }
        const obj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
          obj[k] = unmarshall(v);
        }
        return wrapStatsObject(obj);
      }
      return data;
    }

    ws.onopen = () => {
      resolve(lumiana);
    };

    ws.onerror = (err) => {
      reject(err);
    };

    ws.onclose = () => {
      localCallbacks.clear();
      pendingRequests.forEach(({ reject }) => reject(new Error('[Lumiana] WebSocket closed')));
      pendingRequests.clear();
    };

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      if (data.length === 0) return;

      const opcode = data[0];

      // Opcode 0x02 = PONG
      if (opcode === 0x02 && data.length >= 22) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const clientTimestamp = Number(view.getBigUint64(1));
        const serverTimestamp = Number(view.getBigUint64(9));
        const uptime = view.getUint32(17);
        const mode = data[21] === 0x01 ? 'production' : 'development';

        const latency = Date.now() - clientTimestamp;

        const resolver = pendingPings.get(clientTimestamp);
        if (resolver) {
          pendingPings.delete(clientTimestamp);
          resolver({
            ok: true,
            latency,
            clientTimestamp,
            serverTimestamp,
            uptime,
            mode,
          });
        }
        return;
      }

      // Opcode 0x04 = RUN_FUNCTION_RESULT or 0x06 = NODE_CALL_RESULT
      if (opcode === 0x04 || opcode === 0x06) {
        const text = new TextDecoder().decode(data.subarray(1));
        try {
          const res: ServerExecutionResponse = JSON.parse(text);
          const req = pendingRequests.get(res.id);
          if (req) {
            pendingRequests.delete(res.id);
            if (res.ok) {
              req.resolve(unmarshall(res.result));
            } else {
              req.reject(new Error(res.error || 'Execution failed'));
            }
          }
        } catch (e) {
          console.error('[Lumiana] Failed to parse response:', e);
        }
        return;
      }

      // Opcode 0x07 = CALLBACK_INVOKE
      if (opcode === 0x07) {
        const text = new TextDecoder().decode(data.subarray(1));
        try {
          const msg = JSON.parse(text);
          const cb = localCallbacks.get(msg.cbId);
          if (cb) {
            const rawArgs = Array.isArray(msg.args) ? msg.args : [];
            const args = rawArgs.map(unmarshall);
            cb(...args);
          }
        } catch (err) {
          console.error('[Lumiana] Failed to invoke callback:', err);
        }
        return;
      }

      for (const cb of listeners) {
        cb(data);
      }
    };

    function sendNodeRequest(
      path: string[],
      args: unknown[] | null,
      isCall: boolean,
      refId?: string | null
    ): Promise<unknown> {
      return new Promise<unknown>((res, rej) => {
        if (ws.readyState !== WebSocket.OPEN) {
          return rej(new Error('[Lumiana] WebSocket is not open'));
        }
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        pendingRequests.set(id, { resolve: res, reject: rej });

        const marshalledArgs = args !== null ? args.map(marshall) : null;
        const payload = JSON.stringify({
          id,
          refId: refId || null,
          path,
          args: marshalledArgs,
          isCall,
          module: path[0],
          method: path[1],
        });
        const encoded = new TextEncoder().encode(payload);
        const packet = new Uint8Array(1 + encoded.length);
        packet[0] = 0x05; // NODE_CALL
        packet.set(encoded, 1);
        ws.send(packet);
      });
    }

    function createNodeProxy(path: string[] = [], refId: string | null = null): LumianaNodeProxy {
      const dummy = function () {};

      return new Proxy(dummy, {
        get(_target, prop: string | symbol) {
          if (typeof prop === 'symbol') {
            if (prop === Symbol.toStringTag) return 'LumianaNodeProxy';
            if (prop === Symbol.toPrimitive) return () => `[LumianaNodeProxy ${refId ? `ref:${refId}` : ''} ${path.join('.')}]`;
            return undefined;
          }

          if (prop === 'then') {
            if (path.length === 0) {
              return undefined;
            }
            return (onFulfilled?: (val: any) => any, onRejected?: (err: any) => any) => {
              return sendNodeRequest(path, null, false, refId).then(onFulfilled, onRejected);
            };
          }

          if (prop === 'catch') {
            return (onRejected?: (err: any) => any) => {
              return sendNodeRequest(path, null, false, refId).catch(onRejected);
            };
          }

          if (prop === 'finally') {
            return (onFinally?: () => void) => {
              return sendNodeRequest(path, null, false, refId).finally(onFinally);
            };
          }

          return createNodeProxy([...path, prop], refId);
        },

        apply(_target, _thisArg, args: unknown[]) {
          return sendNodeRequest(path, args, true, refId);
        },
      }) as unknown as LumianaNodeProxy;
    }

    const nodeProxy = createNodeProxy([], null) as unknown as LumianaNode;

    const lumiana: LumianaClient = {
      ws,
      node: nodeProxy,

      ping(): Promise<PingResult> {
        return new Promise((res, rej) => {
          if (ws.readyState !== WebSocket.OPEN) {
            return rej(new Error('[Lumiana] WebSocket is not open'));
          }

          const now = Date.now();
          const buffer = new Uint8Array(9);
          const view = new DataView(buffer.buffer);
          buffer[0] = 0x01; // PING opcode
          view.setBigUint64(1, BigInt(now));

          pendingPings.set(now, res);

          setTimeout(() => {
            if (pendingPings.has(now)) {
              pendingPings.delete(now);
              rej(new Error('[Lumiana] Ping timeout'));
            }
          }, 5000);

          ws.send(buffer);
        });
      },

      run<T = unknown>(
        fn: string | (() => Promise<T> | T) | ((ctx: LumianaRunContext, ...args: any[]) => Promise<T> | T),
        ...args: any[]
      ): any {
        setupBrowserEnvironment();

        if (typeof fn === 'function' && fn.length === 0 && args.length === 0) {
          return (fn as () => any)();
        }

        return new Promise<T>((res, rej) => {
          if (ws.readyState !== WebSocket.OPEN) {
            return rej(new Error('[Lumiana] WebSocket is not open'));
          }
          const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
          const code = typeof fn === 'function' ? fn.toString() : String(fn);

          pendingRequests.set(id, { resolve: res as (val: unknown) => void, reject: rej });

          const payload = JSON.stringify({ id, code, args });
          const encoded = new TextEncoder().encode(payload);
          const packet = new Uint8Array(1 + encoded.length);
          packet[0] = 0x03; // RUN_FUNCTION
          packet.set(encoded, 1);

          ws.send(packet);
        });
      },

      send(data: Uint8Array): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      },

      onMessage(callback: (data: Uint8Array) => void): () => void {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },

      close(): void {
        ws.close();
      },
    };
  });
}

export interface ConnectFunction {
  (creds?: Credentials): Promise<LumianaClient>;
  credentials(creds: Credentials): Promise<LumianaClient>;
}

export const connect: ConnectFunction = Object.assign(
  (creds?: Credentials) => baseConnect(creds),
  {
    credentials(creds: Credentials): Promise<LumianaClient> {
      return baseConnect(creds);
    },
  }
);

export function run<T = unknown>(bootstrap: () => Promise<T> | T): Promise<T> | T {
  setupBrowserEnvironment();
  return bootstrap();
}

export interface LumianaApp {
  connect: ConnectFunction;
  run: typeof run;
  createNodeModuleProxy: typeof createNodeModuleProxy;
  syncNodeCall: typeof syncNodeCall;
  Buffer: typeof LumianaBuffer;
}

export const lumiana: LumianaApp = {
  connect,
  run,
  createNodeModuleProxy,
  syncNodeCall,
  Buffer: LumianaBuffer,
};

export default connect;

