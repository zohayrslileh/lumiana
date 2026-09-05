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

export interface Lumiana {
  connected(): boolean;
  disconnect(): void;
  ping(): Promise<PingResult>;
}

export type LumianaClient = Lumiana;

export interface Credentials {
  readonly username: string;
  readonly password: string;
  readonly url?: string;
  readonly syncUrl?: string;
}

export interface ConnectAPI {
  credentials(creds: Credentials): Promise<Lumiana>;
}

interface ActiveConnection {
  ws: WebSocket;
  pendingRequests: Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>;
  pendingPings: Map<number, (res: PingResult) => void>;
  sendNodeRequest(
    path: string[],
    args: unknown[] | null,
    isCall: boolean,
    refId?: string | null,
    isConstructor?: boolean
  ): Promise<unknown>;
}

let activeConnection: ActiveConnection | null = null;
let isConnecting = false;
let activeCredentials: Credentials = { username: 'lumiana', password: 'lumiana' };

export class LumianaBuffer extends Uint8Array {
  static get [Symbol.species]() {
    return LumianaBuffer;
  }

  get _isBuffer(): boolean {
    return true;
  }

  override toString(encoding: string = 'utf8', start?: number, end?: number): string {
    const sub = (start !== undefined || end !== undefined) ? this.subarray(start, end) : this;
    const enc = (encoding || 'utf8').toLowerCase().replace('-', '');
    if (enc === 'hex') {
      let hex = '';
      for (let i = 0; i < sub.length; i++) {
        hex += sub[i].toString(16).padStart(2, '0');
      }
      return hex;
    }
    if (enc === 'base64' || enc === 'base64url') {
      let binary = '';
      const len = sub.length;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(sub[i]);
      }
      const b64 = typeof btoa !== 'undefined' ? btoa(binary) : '';
      return enc === 'base64url' ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
    }
    if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
      let str = '';
      for (let i = 0; i < sub.length; i++) {
        str += String.fromCharCode(sub[i]);
      }
      return str;
    }
    return new TextDecoder(enc === 'utf8' ? 'utf-8' : encoding).decode(sub);
  }

  write(string: string, offset: number = 0, length?: number | string, encoding: string = 'utf8'): number {
    const enc = typeof length === 'string' ? length : encoding;
    const len = typeof length === 'number' ? length : this.length - offset;
    const buf = LumianaBuffer.from(string, enc);
    const toCopy = Math.min(len, buf.length, Math.max(0, this.length - offset));
    this.set(buf.subarray(0, toCopy), offset);
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

  compare(target: Uint8Array, targetStart: number = 0, targetEnd?: number, sourceStart: number = 0, sourceEnd?: number): number {
    const src = this.subarray(sourceStart, sourceEnd);
    const tgt = target.subarray(targetStart, targetEnd);
    return LumianaBuffer.compare(src, tgt);
  }

  slice(start?: number, end?: number): LumianaBuffer {
    const sub = super.subarray(start, end);
    return new LumianaBuffer(sub.buffer, sub.byteOffset, sub.byteLength);
  }

  override subarray(start?: number, end?: number): LumianaBuffer {
    const sub = super.subarray(start, end);
    return new LumianaBuffer(sub.buffer, sub.byteOffset, sub.byteLength);
  }

  readUInt8(offset: number = 0): number {
    return this[offset];
  }

  readInt8(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt8(offset);
  }

  writeUInt8(val: number, offset: number = 0): number {
    this[offset] = val & 0xff;
    return offset + 1;
  }

  writeInt8(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt8(offset, val);
    return offset + 1;
  }

  readUInt16BE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, false);
  }

  readUInt16LE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, true);
  }

  readInt16BE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(offset, false);
  }

  readInt16LE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(offset, true);
  }

  writeUInt16BE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, val, false);
    return offset + 2;
  }

  writeUInt16LE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, val, true);
    return offset + 2;
  }

  writeInt16BE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(offset, val, false);
    return offset + 2;
  }

  writeInt16LE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(offset, val, true);
    return offset + 2;
  }

  readUInt32BE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, false);
  }

  readUInt32LE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, true);
  }

  readInt32BE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt32(offset, false);
  }

  readInt32LE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt32(offset, true);
  }

  writeUInt32BE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, val, false);
    return offset + 4;
  }

  writeUInt32LE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, val, true);
    return offset + 4;
  }

  writeInt32BE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt32(offset, val, false);
    return offset + 4;
  }

  writeInt32LE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setInt32(offset, val, true);
    return offset + 4;
  }

  readFloatBE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset, false);
  }

  readFloatLE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset, true);
  }

  writeFloatBE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat32(offset, val, false);
    return offset + 4;
  }

  writeFloatLE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat32(offset, val, true);
    return offset + 4;
  }

  readDoubleBE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(offset, false);
  }

  readDoubleLE(offset: number = 0): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(offset, true);
  }

  writeDoubleBE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(offset, val, false);
    return offset + 8;
  }

  writeDoubleLE(val: number, offset: number = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(offset, val, true);
    return offset + 8;
  }

  static isBuffer(obj: unknown): boolean {
    return obj instanceof Uint8Array || (obj !== null && typeof obj === 'object' && (obj as any)._isBuffer === true);
  }

  static isEncoding(encoding: string): boolean {
    if (typeof encoding !== 'string' || encoding.length === 0) return false;
    const enc = encoding.toLowerCase().replace('-', '');
    return ['utf8', 'utf16le', 'ucs2', 'base64', 'base64url', 'latin1', 'binary', 'hex', 'ascii'].includes(enc);
  }

  static byteLength(string: unknown, encoding: string = 'utf8'): number {
    if (typeof string === 'string') {
      const enc = (encoding || 'utf8').toLowerCase().replace('-', '');
      if (enc === 'hex') return string.length >>> 1;
      if (enc === 'base64' || enc === 'base64url') {
        let len = string.length;
        if (string.endsWith('==')) len -= 2;
        else if (string.endsWith('=')) len -= 1;
        return Math.max(0, Math.floor((len * 3) / 4));
      }
      if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') return string.length;
      if (enc === 'utf16le' || enc === 'ucs2') return string.length * 2;
      return new TextEncoder().encode(string).length;
    }
    if (string instanceof Uint8Array || string instanceof ArrayBuffer || (string && typeof (string as any).byteLength === 'number')) {
      return (string as any).byteLength;
    }
    return 0;
  }

  static compare(buf1: Uint8Array, buf2: Uint8Array): number {
    if (buf1 === buf2) return 0;
    const len = Math.min(buf1.length, buf2.length);
    for (let i = 0; i < len; i++) {
      if (buf1[i] !== buf2[i]) {
        return buf1[i] < buf2[i] ? -1 : 1;
      }
    }
    return buf1.length < buf2.length ? -1 : (buf1.length > buf2.length ? 1 : 0);
  }

  static alloc(size: number, fill?: number | string | Uint8Array, encoding: string = 'utf8'): LumianaBuffer {
    const buf = new LumianaBuffer(size);
    if (fill !== undefined) {
      if (typeof fill === 'number') {
        buf.fill(fill);
      } else {
        const fillBuf = typeof fill === 'string' ? LumianaBuffer.from(fill, encoding) : fill;
        if (fillBuf && fillBuf.length > 0) {
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

  static allocUnsafeSlow(size: number): LumianaBuffer {
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
      const enc = (typeof _encodingOrMap === 'string' ? _encodingOrMap : 'utf8').toLowerCase().replace('-', '');
      if (enc === 'hex') {
        const matches = data.match(/.{1,2}/g) || [];
        return new LumianaBuffer(matches.map((byte: string) => parseInt(byte, 16)));
      }
      if (enc === 'base64' || enc === 'base64url') {
        const binStr = typeof atob !== 'undefined' ? atob(data.replace(/-/g, '+').replace(/_/g, '/')) : '';
        const len = binStr.length;
        const bytes = new LumianaBuffer(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        return bytes;
      }
      if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
        const bytes = new LumianaBuffer(data.length);
        for (let i = 0; i < data.length; i++) {
          bytes[i] = data.charCodeAt(i) & 0xff;
        }
        return bytes;
      }
      return new LumianaBuffer(new TextEncoder().encode(data));
    }
    if (data instanceof Uint8Array) {
      return new LumianaBuffer(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof ArrayBuffer) {
      return new LumianaBuffer(data, _encodingOrMap, _thisArg);
    }
    if (Array.isArray(data)) {
      return new LumianaBuffer(data);
    }
    return new LumianaBuffer();
  }
}

export { LumianaBuffer as Buffer };

function getSyncHttpUrl(): string {
  if (activeCredentials?.syncUrl) {
    return activeCredentials.syncUrl;
  }
  if (typeof location !== 'undefined') {
    return `${location.protocol}//${location.host}/__lumiana_sync_node__`;
  }
  return 'http://localhost:3883/__lumiana_sync_node__';
}

export function syncNodeCall(
  refId: string | null,
  path: string[],
  args: unknown[] | null,
  isCall: boolean = true,
  isConstructor: boolean = false
): unknown {
  if (!lumiana.connected()) {
    throw new Error('[Lumiana] No active connection. Call connect.credentials() before using Node modules.');
  }

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
  const payload = JSON.stringify({ refId, path, args: marshalledArgs, isCall, isConstructor });

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

const globalLocalCallbacks = new Map<string, (...args: unknown[]) => unknown>();

function marshallValue(value: unknown): unknown {
  if (typeof value === 'function') {
    const cbId = 'cb_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    globalLocalCallbacks.set(cbId, value as (...args: unknown[]) => unknown);
    return { __lumiana_cb__: cbId };
  }
  if (value instanceof Uint8Array) {
    return { __lumiana_bin__: Array.from(value) };
  }
  if (Array.isArray(value)) {
    return value.map(marshallValue);
  }
  if (value !== null && typeof value === 'object') {
    if ((value as any).__lumiana_ref__) {
      return { __lumiana_ref__: (value as any).__lumiana_ref__ };
    }
    if (typeof (value as any).fetch === 'function') {
      const fetchCb = (value as any).fetch.bind(value);
      const cbId = 'cb_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      globalLocalCallbacks.set(cbId, fetchCb);
      const obj: Record<string, unknown> = {
        fetch: { __lumiana_cb__: cbId },
      };
      if (typeof (value as any).port === 'number') obj.port = (value as any).port;
      if (typeof (value as any).hostname === 'string') obj.hostname = (value as any).hostname;
      return obj;
    }

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
      const refId = (data as { __lumiana_ref__: string }).__lumiana_ref__;
      const staticProps: Record<string, unknown> = {};
      if ((data as any).__props__ && typeof (data as any).__props__ === 'object') {
        for (const [k, v] of Object.entries((data as any).__props__)) {
          staticProps[k] = unmarshallValue(v);
        }
      }
      return createNodeModuleProxy('ref', [], refId, staticProps);
    }
    if ((data as { __lumiana_bin__?: number[] }).__lumiana_bin__) {
      return LumianaBuffer.from((data as { __lumiana_bin__: number[] }).__lumiana_bin__);
    }
    if ((data as any)?.__lumiana_request__) {
      const reqData = data as any;
      const reqInit: RequestInit = {
        method: reqData.method,
        headers: reqData.headers,
      };
      const fullUrl = reqData.url.startsWith('http://') || reqData.url.startsWith('https://')
        ? reqData.url
        : `http://localhost${reqData.url.startsWith('/') ? '' : '/'}${reqData.url}`;
      return new Request(fullUrl, reqInit);
    }
    if ((data as any)?.__lumiana_response__) {
      const respData = data as any;
      const isNullBodyStatus = [101, 204, 205, 304].includes(respData.status);
      const bodyBuf = isNullBodyStatus || !respData.body
        ? null
        : (Array.isArray(respData.body) ? new Uint8Array(respData.body) : respData.body);
      if (typeof Response !== 'undefined') {
        return new Response(bodyBuf, {
          status: respData.status,
          statusText: respData.statusText,
          headers: respData.headers,
        });
      }
      return {
        ok: respData.status >= 200 && respData.status < 300,
        status: respData.status,
        statusText: respData.statusText,
        headers: typeof Headers !== 'undefined' ? new Headers(respData.headers) : respData.headers,
        async text() {
          return new TextDecoder().decode(bodyBuf || new Uint8Array());
        },
        async json() {
          const t = new TextDecoder().decode(bodyBuf || new Uint8Array());
          return JSON.parse(t);
        },
        async arrayBuffer() {
          return (bodyBuf || new Uint8Array()).buffer;
        },
      };
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
        if (prop in _target) return (_target as any)[prop];
        if (prop === Symbol.toStringTag) return `[NodeModule ${moduleName}]`;
        if (prop === Symbol.toPrimitive) return () => `[NodeModule ${moduleName} ${path.join('.')}]`;
        return undefined;
      }

      if (typeof prop === 'string' && prop in staticValues) {
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

    set(_target, prop: string | symbol, val: any) {
      if (typeof prop === 'string') {
        staticValues[prop] = val;
        if (refId) {
          try {
            syncNodeCall(refId, [prop], [val], true);
          } catch {}
        }
      } else {
        (_target as any)[prop] = val;
      }
      return true;
    },

    construct(_target, args: unknown[]): object {
      return (syncNodeCall(refId, path, args, true, true) as object) || {};
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
  if (activeCredentials?.url) {
    const url = new URL(activeCredentials.url);
    if (username && !url.searchParams.has('username')) url.searchParams.set('username', username);
    if (password && !url.searchParams.has('password')) url.searchParams.set('password', password);
    return url.toString();
  }
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

let activeSendNodeRequest: ((
  path: string[],
  args: unknown[] | null,
  isCall: boolean,
  refId?: string | null,
  isConstructor?: boolean
) => Promise<unknown>) | null = null;

export async function lumianaSmartFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const originalFetch: typeof fetch | null =
    (typeof window !== 'undefined' && (window as any).__lumiana_original_fetch__) ||
    (typeof globalThis !== 'undefined' && (globalThis as any).__lumiana_original_fetch__) ||
    (typeof globalThis !== 'undefined' && globalThis.fetch !== lumianaSmartFetch ? globalThis.fetch.bind(globalThis) : null);

  let urlString: string;
  if (typeof input === 'string') {
    urlString = input;
  } else if (typeof URL !== 'undefined' && input instanceof URL) {
    urlString = input.href;
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    urlString = input.url;
  } else {
    urlString = String(input);
  }

  const isInternal =
    urlString.startsWith('/') ||
    urlString.startsWith('./') ||
    urlString.startsWith('../') ||
    urlString.startsWith('blob:') ||
    urlString.startsWith('data:') ||
    urlString.includes('/@vite/') ||
    urlString.includes('/@fs/') ||
    urlString.includes('/@id/') ||
    urlString.startsWith('/__vite') ||
    urlString.startsWith('/__lumiana') ||
    (typeof location !== 'undefined' && (urlString.startsWith(location.origin) || urlString.startsWith(location.host)));

  if (isInternal) {
    if (originalFetch) {
      return originalFetch(input, init);
    }
    throw new Error(`[Lumiana fetch] No browser fetch available for internal URL: ${urlString}`);
  }

  // External / Cross-Origin URL -> Requires active connection to Node.js!
  if (!lumiana.connected()) {
    throw new Error('[Lumiana] No active connection. Call connect.credentials() before fetching external resources.');
  }

  const method = (
    init?.method ||
    (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase();

  const headers: Record<string, string> = {};
  if (typeof Request !== 'undefined' && input instanceof Request && input.headers) {
    input.headers.forEach((value, key) => {
      headers[key] = value;
    });
  }
  if (init?.headers) {
    if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        headers[k] = v;
      }
    } else if (typeof init.headers === 'object') {
      Object.assign(headers, init.headers);
    }
  }

  let body: any = init?.body;
  if (body === undefined && typeof Request !== 'undefined' && input instanceof Request) {
    if (method !== 'GET' && method !== 'HEAD' && !input.bodyUsed) {
      try {
        body = await input.arrayBuffer();
      } catch {}
    }
  }

  const nodeOptions: Record<string, any> = {
    method,
    headers,
  };

  if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
    if (typeof body === 'string') {
      nodeOptions.body = body;
    } else if (body instanceof ArrayBuffer) {
      nodeOptions.body = { __lumiana_bin__: Array.from(new Uint8Array(body)) };
    } else if (ArrayBuffer.isView(body)) {
      nodeOptions.body = {
        __lumiana_bin__: Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)),
      };
    } else if (typeof Blob !== 'undefined' && body instanceof Blob) {
      const ab = await body.arrayBuffer();
      nodeOptions.body = { __lumiana_bin__: Array.from(new Uint8Array(ab)) };
    } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      nodeOptions.body = body.toString();
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      }
    } else {
      nodeOptions.body = body;
    }
  }

  if (init?.redirect) {
    nodeOptions.redirect = init.redirect;
  }

  // 1. If WebSocket RPC is connected, send through WebSocket
  if (activeSendNodeRequest) {
    const res = await activeSendNodeRequest(['fetch'], [urlString, nodeOptions], true);
    return res as Response;
  }

  // 2. Fallback to HTTP RPC endpoint
  if (originalFetch) {
    const rpcUrl = getSyncHttpUrl();
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (activeCredentials?.username || activeCredentials?.password) {
      const user = activeCredentials.username || '';
      const pass = activeCredentials.password || '';
      const token =
        typeof btoa !== 'undefined'
          ? btoa(`${user}:${pass}`)
          : LumianaBuffer.from(`${user}:${pass}`).toString('base64');
      authHeaders['Authorization'] = `Basic ${token}`;
      authHeaders['x-lumiana-auth'] = token;
    }

    const rpcPayload = JSON.stringify({
      refId: null,
      path: ['fetch'],
      args: [urlString, nodeOptions],
      isCall: true,
      isConstructor: false,
    });

    const httpRes = await originalFetch(rpcUrl, {
      method: 'POST',
      headers: authHeaders,
      body: rpcPayload,
    });

    if (!httpRes.ok) {
      throw new Error(`[Lumiana fetch] HTTP RPC error: status ${httpRes.status}`);
    }

    const data: any = await httpRes.json();
    if (!data.ok) {
      throw new Error(data.error?.message || data.error || '[Lumiana fetch] Node fetch call failed');
    }

    return unmarshallValue(data.result) as Response;
  }

  throw new Error('[Lumiana fetch] No transport available to send fetch to Node');
}

export function setupBrowserEnvironment(): void {
  if (typeof window !== 'undefined') {
    if (!(window as any).__lumiana_original_fetch__ && typeof window.fetch === 'function') {
      (window as any).__lumiana_original_fetch__ = window.fetch.bind(window);
    }
    (window as any).fetch = lumianaSmartFetch;
    (window as any).global = window;
    (window as any).Buffer = LumianaBuffer;
    (window as any).process = createProcessObject();
    if (typeof (window as any).setImmediate === 'undefined') {
      (window as any).setImmediate = (fn: any, ...args: any[]) => setTimeout(fn, 0, ...args);
      (window as any).clearImmediate = (id: any) => clearTimeout(id);
    }
  }
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any).__lumiana_original_fetch__ && typeof globalThis.fetch === 'function' && globalThis.fetch !== lumianaSmartFetch) {
      (globalThis as any).__lumiana_original_fetch__ = globalThis.fetch.bind(globalThis);
    }
    (globalThis as any).fetch = lumianaSmartFetch;
    (globalThis as any).global = globalThis;
    (globalThis as any).Buffer = LumianaBuffer;
    (globalThis as any).process = createProcessObject();
  }
}

async function baseConnect(creds?: Credentials): Promise<LumianaClient> {
  setupBrowserEnvironment();
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
    const localCallbacks = globalLocalCallbacks;

    function marshall(value: unknown): unknown {
      if (typeof value === 'function') {
        const cbId = 'cb_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        globalLocalCallbacks.set(cbId, value as (...args: unknown[]) => unknown);
        return { __lumiana_cb__: cbId };
      }
      if (value instanceof Uint8Array) {
        return { __lumiana_bin__: Array.from(value) };
      }
      if (Array.isArray(value)) {
        return value.map(marshall);
      }
      if (value !== null && typeof value === 'object') {
        if ((value as any).__lumiana_ref__) {
          return { __lumiana_ref__: (value as any).__lumiana_ref__ };
        }
        if (typeof (value as any).fetch === 'function') {
          const fetchCb = (value as any).fetch.bind(value);
          const cbId = 'cb_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          globalLocalCallbacks.set(cbId, fetchCb);
          const obj: Record<string, unknown> = {
            fetch: { __lumiana_cb__: cbId },
          };
          if (typeof (value as any).port === 'number') obj.port = (value as any).port;
          if (typeof (value as any).hostname === 'string') obj.hostname = (value as any).hostname;
          return obj;
        }

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
          const refId = (data as { __lumiana_ref__: string }).__lumiana_ref__;
          const staticProps: Record<string, unknown> = {};
          if ((data as any).__props__ && typeof (data as any).__props__ === 'object') {
            for (const [k, v] of Object.entries((data as any).__props__)) {
              staticProps[k] = unmarshall(v);
            }
          }
          return createNodeProxy([], refId, staticProps);
        }
        if ((data as { __lumiana_bin__?: number[] }).__lumiana_bin__) {
          return LumianaBuffer.from((data as { __lumiana_bin__: number[] }).__lumiana_bin__);
        }
        if ((data as any)?.__lumiana_request__) {
          const reqData = data as any;
          const reqInit: RequestInit = {
            method: reqData.method,
            headers: reqData.headers,
          };
          const fullUrl = reqData.url.startsWith('http://') || reqData.url.startsWith('https://')
            ? reqData.url
            : `http://localhost${reqData.url.startsWith('/') ? '' : '/'}${reqData.url}`;
          return new Request(fullUrl, reqInit);
        }
        if ((data as any)?.__lumiana_response__) {
          const respData = data as any;
          const isNullBodyStatus = [101, 204, 205, 304].includes(respData.status);
          const bodyBuf = isNullBodyStatus || !respData.body
            ? null
            : (Array.isArray(respData.body) ? new Uint8Array(respData.body) : respData.body);
          if (typeof Response !== 'undefined') {
            return new Response(bodyBuf, {
              status: respData.status,
              statusText: respData.statusText,
              headers: respData.headers,
            });
          }
          return {
            ok: respData.status >= 200 && respData.status < 300,
            status: respData.status,
            statusText: respData.statusText,
            headers: typeof Headers !== 'undefined' ? new Headers(respData.headers) : respData.headers,
            async text() {
              return new TextDecoder().decode(bodyBuf || new Uint8Array());
            },
            async json() {
              const t = new TextDecoder().decode(bodyBuf || new Uint8Array());
              return JSON.parse(t);
            },
            async arrayBuffer() {
              return (bodyBuf || new Uint8Array()).buffer;
            },
          };
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
      activeConnection = {
        ws,
        pendingRequests,
        pendingPings,
        sendNodeRequest,
      };
      activeSendNodeRequest = sendNodeRequest;
      resolve(lumiana);
    };

    ws.onerror = (err) => {
      if (activeConnection?.ws === ws) {
        activeConnection = null;
        activeSendNodeRequest = null;
      }
      reject(err);
    };

    ws.onclose = () => {
      if (activeConnection?.ws === ws) {
        activeConnection = null;
        activeSendNodeRequest = null;
      }
      localCallbacks.clear();
      pendingRequests.forEach(({ reject }) => reject(new Error('[Lumiana] WebSocket closed')));
      pendingRequests.clear();
      pendingPings.clear();
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
          const cb = localCallbacks.get(msg.cbId) || globalLocalCallbacks.get(msg.cbId);
          if (cb) {
            const isSyncCb = globalLocalCallbacks.has(msg.cbId);
            const rawArgs = Array.isArray(msg.args) ? msg.args : [];
            const args = rawArgs.map(isSyncCb ? unmarshallValue : unmarshall);
            Promise.resolve(cb(...args))
              .then(async (res) => {
                if (msg.callId) {
                  let marshalledResult: unknown;
                  if (typeof Response !== 'undefined' && res instanceof Response) {
                    const headers: Record<string, string> = {};
                    res.headers.forEach((v: string, k: string) => {
                      headers[k] = v;
                    });
                    const bodyText = await res.text();
                    marshalledResult = {
                      __lumiana_response__: true,
                      status: res.status,
                      statusText: res.statusText,
                      headers,
                      body: bodyText,
                    };
                  } else {
                    marshalledResult = marshall(res);
                  }
                  const payload = JSON.stringify({ callId: msg.callId, ok: true, result: marshalledResult });
                  const encoded = new TextEncoder().encode(payload);
                  const packet = new Uint8Array(1 + encoded.length);
                  packet[0] = 0x08; // CALLBACK_RESPONSE
                  packet.set(encoded, 1);
                  ws.send(packet);
                }
              })
              .catch((err) => {
                if (msg.callId) {
                  const payload = JSON.stringify({
                    callId: msg.callId,
                    ok: false,
                    error: err instanceof Error ? err.message : String(err),
                  });
                  const encoded = new TextEncoder().encode(payload);
                  const packet = new Uint8Array(1 + encoded.length);
                  packet[0] = 0x08;
                  packet.set(encoded, 1);
                  ws.send(packet);
                }
              });
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
      refId?: string | null,
      isConstructor: boolean = false
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
          isConstructor,
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

    function createNodeProxy(
      path: string[] = [],
      refId: string | null = null,
      staticValues: Record<string, unknown> = {}
    ): LumianaNodeProxy {
      const dummy = function () {};

      return new Proxy(dummy, {
        get(_target, prop: string | symbol) {
          if (typeof prop === 'symbol') {
            if (prop in _target) return (_target as any)[prop];
            if (prop === Symbol.toStringTag) return 'LumianaNodeProxy';
            if (prop === Symbol.toPrimitive) return () => `[LumianaNodeProxy ${refId ? `ref:${refId}` : ''} ${path.join('.')}]`;
            return undefined;
          }

          if (typeof prop === 'string' && prop in staticValues) {
            return staticValues[prop];
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

        set(_target, prop: string | symbol, val: any) {
          if (typeof prop === 'string') {
            staticValues[prop] = val;
            if (refId) {
              sendNodeRequest([prop], [val], true, refId).catch(() => {});
            }
          } else {
            (_target as any)[prop] = val;
          }
          return true;
        },

        construct(_target, args: unknown[]) {
          return sendNodeRequest(path, args, true, refId, true);
        },

        apply(_target, _thisArg, args: unknown[]) {
          return sendNodeRequest(path, args, true, refId);
        },
      }) as unknown as LumianaNodeProxy;
    }

  });
}

export const lumiana: Lumiana = {
  connected(): boolean {
    return activeConnection !== null && activeConnection.ws.readyState === WebSocket.OPEN;
  },

  disconnect(): void {
    if (activeConnection) {
      try {
        activeConnection.ws.close();
      } catch {}
      activeConnection.pendingRequests.forEach(({ reject }) =>
        reject(new Error('[Lumiana] Connection disconnected'))
      );
      activeConnection.pendingRequests.clear();
      activeConnection.pendingPings.clear();
      activeConnection = null;
    }
    activeSendNodeRequest = null;
    globalLocalCallbacks.clear();
  },

  ping(): Promise<PingResult> {
    if (!lumiana.connected() || !activeConnection) {
      return Promise.reject(new Error('[Lumiana] No active connection. Call connect.credentials() first.'));
    }
    return new Promise<PingResult>((resolve, reject) => {
      if (!activeConnection || activeConnection.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('[Lumiana] No active connection. Call connect.credentials() first.'));
      }
      const clientTimestamp = Date.now();
      activeConnection.pendingPings.set(clientTimestamp, resolve);

      const packet = new Uint8Array(9);
      packet[0] = 0x01; // PING opcode
      const view = new DataView(packet.buffer);
      view.setBigUint64(1, BigInt(clientTimestamp));
      activeConnection.ws.send(packet);

      setTimeout(() => {
        if (activeConnection?.pendingPings.has(clientTimestamp)) {
          activeConnection.pendingPings.delete(clientTimestamp);
          reject(new Error('[Lumiana] Ping timeout'));
        }
      }, 5000);
    });
  },
};

export const connect: ConnectAPI = {
  async credentials(creds: Credentials): Promise<Lumiana> {
    if (lumiana.connected() || activeConnection) {
      throw new Error('[Lumiana] Connection already active. Call lumiana.disconnect() before connecting again.');
    }
    if (isConnecting) {
      throw new Error('[Lumiana] Connection is already in progress.');
    }

    isConnecting = true;
    try {
      await baseConnect(creds);
      return lumiana;
    } finally {
      isConnecting = false;
    }
  },
};

export { lumianaSmartFetch as fetch };
export default connect;

