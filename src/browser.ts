import { Buffer } from 'buffer';
export { Buffer } from 'buffer';
import {
  dispatchKernel,
  installKernel,
  kernelCall,
  kernelCallSync,
  kernelSubscribe,
  removeKernel,
} from './runtime/bridge.js';
import processRuntime, { initializeProcess } from './runtime/process.js';
import { initializeConstants } from './runtime/constants.js';
import { installGlobals } from './runtime/globals.js';
import { clearOS, initializeOS } from './runtime/os.js';
import { initializePerformance } from './runtime/perf-hooks.js';
import {
  clearImmediate as localClearImmediate,
  setImmediate as localSetImmediate,
} from './runtime/timers.js';
import { PREFIX, encodePacket, decodePacket, restoreError, type Invocation } from './protocol.js';
import { decodeException, decodeValue, encodeException, encodeValue } from './values.js';
export interface Credentials {
  username: string;
  password: string;
  url?: string;
}
export interface ServerStatus {
  pid: number;
  uptime: number;
  serverTime: number;
  mode: 'development' | 'production';
  version: string;
  platform: string;
  connections: number;
  latency: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
}
export interface Lumiana {
  status(): Promise<ServerStatus>;
  disconnect(): void;
}
interface Connection {
  socket: WebSocket;
  base: URL;
  id: string;
  key: string;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  sequence: number;
  callbacks: Map<number, (receiver: any, args: any[]) => any>;
  callbackHandles: WeakMap<Function, number>;
  callbackSequence: number;
  addons: {
    values: Map<number, any>;
    handles: Map<any, number>;
  };
}
interface Context {
  instance: Lumiana;
  connection?: Connection;
  connecting: boolean;
  prefix: string;
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  XMLHttpRequest: typeof XMLHttpRequest;
  moduleRoot: string;
}
const singletonKey = Symbol.for('lumiana.context');
const global = globalThis as any;
function connection(): Connection {
  const value = state.connection;
  if (!value || value.socket.readyState !== 1)
    throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return value;
}
const state: Context = (global[singletonKey] ??= {
  connecting: false,
  prefix: PREFIX,
  fetch: globalThis.fetch?.bind(globalThis),
  WebSocket: globalThis.WebSocket,
  XMLHttpRequest: globalThis.XMLHttpRequest,
  moduleRoot: '/',
  instance: new Proxy(
    {
      async status(): Promise<ServerStatus> {
        const c = connection(),
          start = performance.now(),
          id = ++c.sequence;
        const result = await new Promise<any>((resolve, reject) => {
          c.pending.set(id, { resolve, reject });
          send(c, { type: 'status', id });
        });
        return { ...result, latency: performance.now() - start };
      },
      disconnect(): void {
        const c = connection();
        close(c);
        c.socket.close(1000, 'Disconnected');
      },
    },
    {
      get(target, key, receiver) {
        connection();
        return Reflect.get(target, key, receiver);
      },
      set() {
        connection();
        throw new TypeError('Lumiana methods are read-only');
      },
      ownKeys(target) {
        connection();
        return Reflect.ownKeys(target);
      },
      has(target, key) {
        connection();
        return Reflect.has(target, key);
      },
      getOwnPropertyDescriptor(target, key) {
        connection();
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        connection();
        return Reflect.getPrototypeOf(target);
      },
      defineProperty() {
        connection();
        throw new TypeError('Lumiana methods are read-only');
      },
      deleteProperty() {
        connection();
        throw new TypeError('Lumiana methods are read-only');
      },
      setPrototypeOf() {
        connection();
        throw new TypeError('Lumiana methods are read-only');
      },
      preventExtensions() {
        connection();
        throw new TypeError('Lumiana methods are read-only');
      },
      isExtensible(target) {
        connection();
        return Reflect.isExtensible(target);
      },
    },
  ),
});
export const lumiana: Lumiana = state.instance;
/** @internal The plugin supplies its Vite base path. */
export function configureClient(prefix: string): void {
  state.prefix = prefix;
}
function send(c: Connection, packet: any): void {
  if (c.socket.readyState !== 1) throw new Error('Lumiana is disconnected');
  c.socket.send(encodePacket(packet) as Uint8Array<ArrayBuffer>);
}
function close(c: Connection, error = new Error('Lumiana is disconnected')): void {
  if (state.connection === c) state.connection = undefined;
  clearOS();
  removeKernel(c);
  for (const promise of c.pending.values()) promise.reject(error);
  c.pending.clear();
  c.addons.values.clear();
  c.callbacks.clear();
}
function project(c: Connection, packet: any): void {
  if (packet.type === 'console') {
    const method = (console as any)[packet.level] ?? console.log;
    method.apply(
      console,
      packet.text !== undefined
        ? [packet.text]
        : packet.values.map((value: any, i: number) =>
            packet.errors?.[i] ? restoreError(packet.errors[i]) : decodeValue(value),
          ),
    );
  } else if (packet.type === 'fatal') {
    const error = restoreError(packet.error);
    console.error(error);
    if (typeof ErrorEvent === 'function')
      globalThis.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    close(c, error);
    c.socket.close();
  }
}
function registerCallback(
  c: Connection,
  callback: Function,
  execute = (receiver: any, args: any[]) => Reflect.apply(callback, receiver, args),
): number {
  let id = c.callbackHandles.get(callback);
  if (id === undefined) {
    id = ++c.callbackSequence;
    c.callbackHandles.set(callback, id);
    c.callbacks.set(id, execute);
  }
  return id;
}
function executeCallback(c: Connection, packet: any): any {
  const execute = c.callbacks.get(packet.callback);
  if (!execute) throw new ReferenceError(`Unknown native callback ${packet.callback}`);
  const value = execute(decodeValue(packet.receiver), decodeValue(packet.args));
  if (packet.synchronous && value && typeof value.then === 'function')
    throw new TypeError('A synchronous native callback cannot return a Promise');
  return value;
}

function callbackResult(c: Connection, packet: any): any {
  try {
    const value = executeCallback(c, packet);
    if (value && typeof value.then === 'function')
      throw new TypeError('A synchronous native callback cannot return a Promise');
    return {
      type: 'callback-result',
      id: packet.id,
      context: packet.context,
      ok: true,
      value: encodeValue(value),
    };
  } catch (error) {
    return {
      type: 'callback-result',
      id: packet.id,
      context: packet.context,
      ok: false,
      error: encodeException(error),
    };
  }
}

function sync(c: Connection, invocation: Invocation): any {
  if (state.connection !== c) throw new Error('Lumiana is disconnected');
  let packet: any = { type: 'invoke', id: ++c.sequence, sync: true, invocation };
  for (;;) {
    const xhr = new state.XMLHttpRequest();
    xhr.open('POST', new URL('sync', c.base).href, false);
    xhr.setRequestHeader('Content-Type', 'application/msgpack');
    xhr.setRequestHeader('X-Lumiana-Session', c.id);
    xhr.send(encodePacket(packet) as Uint8Array<ArrayBuffer>);
    if (xhr.status !== 200)
      throw new Error(xhr.responseText || `Lumiana request failed (${xhr.status})`);
    const reply = decodePacket(Buffer.from(xhr.responseText, 'base64'));
    for (const log of reply.logs ?? []) project(c, log);
    if (reply.type === 'callback') {
      packet = callbackResult(c, reply);
      continue;
    }
    if (!reply.ok) throw decodeException(reply.error);
    return decodeValue(reply.value);
  }
}

function invoke(c: Connection, operation: string, ...args: any[]): Promise<any> {
  const id = ++c.sequence;
  return new Promise((resolve, reject) => {
    c.pending.set(id, { resolve, reject });
    send(c, {
      type: 'invoke',
      id,
      invocation: { operation, args: args.map((value) => encodeValue(value)) },
    });
  });
}
export const connect = {
  async credentials(credentials: Credentials): Promise<Lumiana> {
    const base = new URL(state.prefix, credentials.url ?? globalThis.location?.href);
    const key = JSON.stringify([base.href, credentials.username, credentials.password]);
    if (state.connection) {
      if (state.connection.key !== key)
        throw new Error('A different Lumiana connection is already active');
      connection();
      return lumiana;
    }
    if (state.connecting) throw new Error('A Lumiana connection is already being established');
    state.connecting = true;
    try {
      const response = await state.fetch(new URL('connect', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/msgpack' },
        body: encodePacket(credentials) as Uint8Array<ArrayBuffer>,
      });
      if (!response.ok) throw new Error(await response.text());
      const initial = decodePacket(new Uint8Array(await response.arrayBuffer()));
      if (!initial.id) throw restoreError(initial.error);
      const url = new URL('ws', base);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('id', initial.id);
      const socket = new state.WebSocket(url);
      socket.binaryType = 'arraybuffer';
      const c: Connection = {
        socket,
        base,
        id: initial.id,
        key,
        pending: new Map(),
        sequence: 0,
        callbacks: new Map(),
        callbackHandles: new WeakMap(),
        callbackSequence: 0,
        addons: {
          values: new Map(),
          handles: new Map(),
        },
      };
      await new Promise<void>((resolve, reject) => {
        socket.onmessage = (event) => {
          try {
            const packet = decodePacket(new Uint8Array(event.data));
            if (packet.type === 'ready') {
              state.connection = c;
              state.moduleRoot = initial.root;
              initializeProcess(initial.process);
              initializeConstants(initial.constants);
              initializeOS(initial.os);
              initializePerformance(initial.performance);
              installKernel(
                c,
                (operation, ...args) => invoke(c, 'kernel', operation, ...args),
                (operation, ...args) =>
                  sync(c, {
                    operation: 'kernelSync',
                    args: [operation, ...args].map((value) => encodeValue(value)),
                  }),
                (callback) => registerCallback(c, callback),
              );
              resolve();
              return;
            }
            if (packet.type === 'console' || packet.type === 'fatal') {
              project(c, packet);
              return;
            }
            if (packet.type === 'kernel-event') {
              dispatchKernel(packet.handle, packet.event, decodeValue(packet.value));
              return;
            }
            if (packet.type === 'callback') {
              Promise.resolve()
                .then(() => executeCallback(c, packet))
                .then(
                  (value) => ({
                    type: 'callback-result',
                    id: packet.id,
                    ok: true,
                    value: encodeValue(value),
                  }),
                  (error) => ({
                    type: 'callback-result',
                    id: packet.id,
                    ok: false,
                    error: encodeException(error),
                  }),
                )
                .then((reply) => {
                  if (state.connection === c && c.socket.readyState === 1) send(c, reply);
                });
              return;
            }
            const pending = c.pending.get(packet.id);
            if (pending) {
              c.pending.delete(packet.id);
              packet.ok === false
                ? pending.reject(decodeException(packet.error) as Error)
                : pending.resolve(decodeValue(packet.value));
            }
          } catch (error) {
            reject(error);
            close(c, error as Error);
            socket.close();
          }
        };
        socket.onerror = () => {
          const error = new Error('Lumiana connection failed');
          reject(error);
          close(c, error);
        };
        socket.onclose = () => {
          const error = new Error('Lumiana connection closed');
          reject(error);
          close(c, error);
        };
      });
      return lumiana;
    } finally {
      state.connecting = false;
    }
  },
};

function packAddon(c: Connection, value: any, seen = new Map<any, any>()): any {
  const reference =
    value &&
    (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol');
  const handle = reference ? c.addons.handles.get(value) : undefined;
  if (handle !== undefined) return { __lumianaAddon: handle };
  if (typeof value === 'function') {
    const id = registerCallback(c, value, (receiver, args) => {
      const result: any = Reflect.apply(
        value,
        materializeAddon(c, receiver),
        args.map((arg: any) => materializeAddon(c, arg)),
      );
      return result && typeof result.then === 'function'
        ? result.then((value: any) => packAddon(c, value))
        : packAddon(c, result);
    });
    return { __lumianaCallback: id };
  }
  if (!value || typeof value !== 'object') return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Date)
    return value;
  if (seen.has(value)) return seen.get(value);
  const result: any = Array.isArray(value) ? [] : Object.create(null);
  seen.set(value, result);
  for (const key of Object.keys(value)) result[key] = packAddon(c, value[key], seen);
  return result;
}

function addonOperation(c: Connection, operation: string, ...args: any[]): any {
  if (state.connection !== c) throw new Error('Lumiana native-addon resource is disconnected');
  return sync(c, {
    operation: 'kernelSync',
    args: [operation, ...args.map((value) => packAddon(c, value))].map(encodeValue),
  });
}

function materializeAddon(c: Connection, descriptor: any): any {
  if (descriptor.kind === 'copy') return descriptor.value;
  if (descriptor.kind === 'promise')
    return kernelCall('addon.await', descriptor.handle).then((value) => materializeAddon(c, value));
  if (descriptor.kind === 'handle') {
    const value = c.addons.values.get(descriptor.handle);
    if (!value) throw new ReferenceError(`Unknown native-addon handle ${descriptor.handle}`);
    return value;
  }
  if (descriptor.kind === 'symbol') {
    const previous = c.addons.values.get(descriptor.handle);
    if (previous) return previous;
    const value =
      descriptor.key === undefined ? Symbol(descriptor.description) : Symbol.for(descriptor.key);
    c.addons.values.set(descriptor.handle, value);
    c.addons.handles.set(value, descriptor.handle);
    return value;
  }
  if (descriptor.kind !== 'resource') throw new TypeError('Invalid native-addon descriptor');
  const previous = c.addons.values.get(descriptor.handle);
  if (previous) return previous;
  let value: any;
  if (descriptor.type === 'function') {
    const perform = (receiver: any, args: any[], construct: boolean) => {
      const receiverHandle = c.addons.handles.get(receiver);
      return materializeAddon(
        c,
        addonOperation(
          c,
          construct ? 'addon.construct' : 'addon.apply',
          descriptor.handle,
          ...(construct ? [args] : [receiverHandle, args]),
        ),
      );
    };
    if (descriptor.constructible)
      value = function (this: any, ...args: any[]) {
        return perform(this, args, Boolean(new.target));
      };
    else {
      const name = descriptor.name || 'nativeAddon';
      value = {
        [name](this: any, ...args: any[]) {
          return perform(this, args, false);
        },
      }[name];
    }
    if (descriptor.name) Object.defineProperty(value, 'name', { value: descriptor.name });
  } else value = descriptor.type === 'array' ? [] : {};
  c.addons.values.set(descriptor.handle, value);
  c.addons.handles.set(value, descriptor.handle);
  if (descriptor.prototype) Object.setPrototypeOf(value, materializeAddon(c, descriptor.prototype));
  for (const property of descriptor.properties) {
    if (property.key === 'prototype' && typeof value === 'function') {
      value.prototype =
        property.value === undefined
          ? materializeAddon(c, addonOperation(c, 'addon.get', descriptor.handle, property.key))
          : materializeAddon(c, property.value);
      continue;
    }
    let current = property.value === undefined ? undefined : materializeAddon(c, property.value);
    Object.defineProperty(value, property.key, {
      configurable: true,
      enumerable: property.enumerable,
      get: () =>
        property.value === undefined
          ? property.kind === 'data' || property.get
            ? materializeAddon(c, addonOperation(c, 'addon.get', descriptor.handle, property.key))
            : undefined
          : current,
      ...(property.writable
        ? {
            set: (next: any) => {
              addonOperation(c, 'addon.set', descriptor.handle, property.key, next);
              if (property.value !== undefined) current = next;
            },
          }
        : {}),
    });
  }
  return value;
}

/** @internal Materialize a native addon's API as local browser functions and objects. */
export function nativeAddon(specifier: string, sourceOrigin?: string): any {
  const c = connection();
  return materializeAddon(c, addonOperation(c, 'addon.load', specifier, sourceOrigin));
}
/** @internal Hybrid invocation emitted for unbound fetch. */
export function hybridFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestURL = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (requestURL.origin === location.origin) return state.fetch(input, init);
  // Request is a browser-owned native value. Extract its standardized request data
  // before handing it to a different implementation of the Fetch contract.
  if (input instanceof Request)
    return (async () => {
      const body = ['GET', 'HEAD'].includes(input.method)
        ? undefined
        : new Uint8Array(await input.arrayBuffer());
      return remoteFetch(requestURL, {
        method: input.method,
        headers: Object.fromEntries(input.headers),
        body,
        redirect: input.redirect,
        credentials: input.credentials,
        cache: input.cache,
        signal: input.signal,
        ...init,
      });
    })();
  return remoteFetch(requestURL, init);
}
function remoteFetch(url: URL, init?: RequestInit): Promise<Response> {
  const options: any = { ...init };
  if (init?.headers) options.headers = Object.fromEntries(new Headers(init.headers));
  delete options.signal;
  const token = crypto.randomUUID();
  const abort = () => void kernelCall('fetch.abort', token).catch(() => {});
  if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
  init?.signal?.addEventListener('abort', abort, { once: true });
  return kernelCall('fetch.request', token, url.href, options)
    .then((result) => {
      const response = new Response(result.body, {
        headers: result.headers,
        status: result.status,
        statusText: result.statusText,
      });
      Object.defineProperties(response, {
        redirected: { configurable: true, value: result.redirected },
        url: { configurable: true, value: result.url },
      });
      return response;
    })
    .catch((error) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      throw error;
    })
    .finally(() => init?.signal?.removeEventListener('abort', abort));
}

class BoundaryWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  readyState = BoundaryWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private handle?: number;
  private stop?: () => void;

  constructor(
    readonly url: string,
    protocols?: string | string[],
  ) {
    super();
    void kernelCall('websocket.open', url, protocols).then(
      ({ handle }) => {
        this.handle = handle;
        this.stop = kernelSubscribe(handle, (name, args) => this.receive(name, args));
      },
      (error) => this.fail(error),
    );
  }

  private emit(event: Event): void {
    this.dispatchEvent(event);
    const listener = (this as any)[`on${event.type}`];
    if (typeof listener === 'function') listener.call(this, event);
  }

  private fail(error: Error): void {
    this.readyState = BoundaryWebSocket.CLOSED;
    const event = new Event('error');
    Object.defineProperty(event, 'error', { value: error });
    this.emit(event);
  }

  private receive(name: string, args: any[]): void {
    if (name === 'open') {
      this.readyState = BoundaryWebSocket.OPEN;
      this.emit(new Event('open'));
    } else if (name === 'message') {
      const value = args[0];
      const data =
        typeof value === 'string'
          ? value
          : this.binaryType === 'arraybuffer'
            ? new Uint8Array(value).buffer
            : new Blob([value]);
      this.emit(new MessageEvent('message', { data }));
    } else if (name === 'error') {
      this.fail(Object.assign(new Error(args[0]?.message), args[0]));
    } else if (name === 'close') {
      this.readyState = BoundaryWebSocket.CLOSED;
      this.stop?.();
      this.emit(new CloseEvent('close', { code: args[0], reason: args[1] }));
    }
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== BoundaryWebSocket.OPEN || this.handle === undefined)
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    if (data instanceof Blob) {
      void data
        .arrayBuffer()
        .then((value) => kernelCall('websocket.send', this.handle!, value))
        .catch((error) => this.fail(error));
    } else void kernelCall('websocket.send', this.handle, data).catch((error) => this.fail(error));
  }

  close(code?: number, reason?: string): void {
    if (this.readyState >= BoundaryWebSocket.CLOSING) return;
    this.readyState = BoundaryWebSocket.CLOSING;
    if (this.handle === undefined) return;
    void kernelCall('websocket.close', this.handle, code, reason).catch(() => {});
  }
}
/** @internal Hybrid constructor emitted for unbound WebSocket. */
export const HybridWebSocket: typeof WebSocket = new Proxy(function () {}.bind(null) as any, {
  construct(_target, args) {
    const url = new URL(String(args[0]), location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    const origin = new URL(url);
    origin.protocol = origin.protocol === 'wss:' ? 'https:' : 'http:';
    const Constructor = origin.origin === location.origin ? state.WebSocket : BoundaryWebSocket;
    return Reflect.construct(Constructor, [url.href, ...args.slice(1)]);
  },
  get(_target, key) {
    return Reflect.get(state.WebSocket, key);
  },
});

/** Resolve build-time module identity against the connected deployment root. */
export function moduleFilename(origin: string): string {
  connection();
  const windows = processRuntime.platform === 'win32';
  const separator = windows ? '\\' : '/';
  const normalizedOrigin = origin.replaceAll('\\', '/');
  const root = state.moduleRoot.replaceAll('\\', '/');
  const absolute =
    normalizedOrigin.startsWith('/') || /^[A-Za-z]:\//.test(normalizedOrigin)
      ? normalizedOrigin
      : `${root}/${normalizedOrigin}`;
  const drive = windows ? (absolute.match(/^[A-Za-z]:/)?.[0] ?? '') : '';
  const parts: string[] = [];
  for (const part of absolute.slice(drive.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${drive}${drive || absolute.startsWith('/') ? separator : ''}${parts.join(separator)}`;
}

export function moduleDirname(origin: string): string {
  const filename = moduleFilename(origin);
  const index = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  return index <= 0 ? filename.slice(0, index + 1) : filename.slice(0, index);
}

// CommonJS cannot contain ESM imports. The Vite transform reads these internal
// capabilities from the browser context after the client bootstrap has loaded.
export const nodeGlobal = installGlobals(globalThis, {
  global: globalThis,
  process: processRuntime,
  Buffer,
  setImmediate: localSetImmediate,
  clearImmediate: localClearImmediate,
});

Object.assign((global[Symbol.for('lumiana.runtime')] ??= Object.create(null)), {
  Buffer,
  HybridWebSocket,
  clearImmediate: localClearImmediate,
  hybridFetch,
  moduleDirname,
  moduleFilename,
  nativeAddon,
  nodeGlobal,
  process: processRuntime,
  setImmediate: localSetImmediate,
});
