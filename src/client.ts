import { Buffer } from 'buffer';
import { References } from './references.js';
import { evaluateExpression } from './references.js';
import {
  PREFIX,
  encodePacket,
  decodePacket,
  failure,
  restoreError,
  restoreException,
  type Graph,
  type Invocation,
  type NativeExpression,
} from './protocol.js';
export { Buffer } from 'buffer';
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
  refs: References;
  socket: WebSocket;
  base: URL;
  id: string;
  key: string;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  sequence: number;
  turn?: number;
}
interface Context {
  instance: Lumiana;
  connection?: Connection;
  connecting: boolean;
  prefix: string;
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  XMLHttpRequest: typeof XMLHttpRequest;
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
  c.refs.close();
  for (const promise of c.pending.values()) promise.reject(error);
  c.pending.clear();
}
function project(c: Connection, packet: any): void {
  if (packet.type === 'console') {
    const method = (console as any)[packet.level] ?? console.log;
    method.apply(
      console,
      packet.text !== undefined
        ? [packet.text]
        : packet.values.map((value: Graph, i: number) =>
            packet.errors?.[i] ? restoreError(packet.errors[i]) : c.refs.decode(value),
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
function callback(c: Connection, packet: any): any {
  try {
    return {
      type: 'callback-result',
      id: packet.id,
      context: packet.context,
      ok: true,
      value: c.refs.execute(packet.invocation),
    };
  } catch (error) {
    return {
      type: 'callback-result',
      id: packet.id,
      context: packet.context,
      ok: false,
      error:
        error instanceof Error
          ? failure(error)
          : { ...failure(error), thrown: c.refs.encode(error) },
    };
  }
}
function sync(c: Connection, invocation: Invocation): Graph {
  if (state.connection !== c) throw new Error('Lumiana is disconnected');
  if (c.turn === undefined) {
    const turn = (c.turn = ++c.sequence);
    queueMicrotask(() => {
      if (c.turn === turn) c.turn = undefined;
      if (state.connection === c) send(c, { type: 'turn-end', turn });
    });
  }
  let packet: any = { type: 'invoke', id: ++c.sequence, turn: c.turn, sync: true, invocation };
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
      packet = callback(c, reply);
      continue;
    }
    if (!reply.ok) throw restoreException(reply.error, (value) => c.refs.decode(value));
    return reply.value;
  }
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
        refs: undefined as any,
      };
      c.refs = new References({
        sync: (invocation) => sync(c, invocation),
        async: (invocation) =>
          new Promise<Graph>((resolve, reject) => {
            const id = ++c.sequence;
            c.pending.set(id, { resolve, reject });
            send(c, { type: 'invoke', id, invocation });
          }),
      });
      await new Promise<void>((resolve, reject) => {
        socket.onmessage = (event) => {
          try {
            const packet = decodePacket(new Uint8Array(event.data));
            if (packet.type === 'ready') {
              state.connection = c;
              resolve();
              return;
            }
            if (packet.type === 'console' || packet.type === 'fatal') {
              project(c, packet);
              return;
            }
            if (packet.type === 'callback') {
              if (packet.invocation.operation === 'await') {
                Promise.resolve(c.refs.decode(packet.invocation.args[0])).then(
                  (value) =>
                    send(c, {
                      type: 'callback-result',
                      id: packet.id,
                      ok: true,
                      value: c.refs.encode(value),
                    }),
                  (error) =>
                    send(c, {
                      type: 'callback-result',
                      id: packet.id,
                      ok: false,
                      error: failure(error),
                    }),
                );
              } else send(c, callback(c, packet));
              return;
            }
            const pending = c.pending.get(packet.id);
            if (pending) {
              c.pending.delete(packet.id);
              packet.ok === false
                ? pending.reject(restoreException(packet.error, (value) => c.refs.decode(value)))
                : pending.resolve(packet.value);
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
/** Resolve a native handler anywhere; connection state is checked at invocation time. */
export function node<T = any>(specifier: string): T {
  return nativeModule(specifier);
}
/** @internal Preserve the importer's native module resolution. */
export function nativeModule<T = any>(
  specifier: string,
  mode?: 'default' | 'namespace',
  origin?: string,
  path: string[] = [],
): T {
  return connection().refs.invokePath('module', [specifier, mode, origin], path);
}
/** @internal Resolve the bindings of one static native import in one request. */
export function nativeBindings<T extends Record<number, any>>(
  specifier: string,
  origin: string | undefined,
  bindings: Record<number, string>,
): T {
  return connection().refs.invoke('moduleBindings', specifier, origin, bindings);
}
/** @internal Read and call a method atomically when its receiver is remote. */
export function invokeMember<T>(receiver: any, key: PropertyKey, ...args: any[]): T {
  const refs = connection().refs;
  if (refs.remote(receiver) !== undefined)
    return refs.invoke('applyMember', receiver, key, ...args) as T;
  return Reflect.apply(Reflect.get(receiver, key, receiver), receiver, args) as T;
}
/** @internal Native dynamic import emitted by Vite. */
export function importNode(specifier: string, origin?: string): Promise<any> {
  return connection().refs.invokeAsync('module', specifier, 'namespace', origin);
}
/** @internal Scope-aware transforms call this without replacing browser globals. */
export function nativeGlobal(name: string, ...path: string[]): any {
  return connection().refs.invokePath('global', [name], path);
}
const intrinsicRoots: Record<string, any> = Object.create(null);
const intrinsicFunctions: Record<string, Function> = Object.create(null);
for (const name of ['JSON', 'Math', 'Object', 'Reflect'])
  intrinsicRoots[name] = (globalThis as any)[name];
for (const [name, root] of Object.entries(intrinsicRoots))
  for (const key of Object.getOwnPropertyNames(root)) {
    const value = Object.getOwnPropertyDescriptor(root, key)?.value;
    if (typeof value === 'function') intrinsicFunctions[`${name}.${key}`] = value;
  }
/** @internal Execute a portable intrinsic expression beside its native-owned values. */
export function evaluateIntrinsic<T>(
  receiver: unknown,
  current: Function,
  path: string[],
  expression: NativeExpression,
): T {
  const intrinsic = intrinsicFunctions[path.join('.')];
  if (current === intrinsic) return connection().refs.invoke('evaluate', expression) as T;
  if (expression.kind !== 'call') throw new TypeError('Invalid intrinsic expression');
  const resolve = (name: string) => (name === path[0] ? intrinsicRoots[name] : nativeGlobal(name));
  return Reflect.apply(
    current,
    receiver,
    Object.values(expression.arguments).map((argument) => evaluateExpression(argument, resolve)),
  ) as T;
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
  const fetch = nativeGlobal('fetch');
  const options: any = { ...init };
  if (init?.headers) options.headers = Object.fromEntries(new Headers(init.headers));
  let cleanup = () => {};
  if (init?.signal) {
    const controller = new (nativeGlobal('AbortController'))();
    const abort = () => controller.abort();
    if (init.signal.aborted) abort();
    else {
      init.signal.addEventListener('abort', abort, { once: true });
      cleanup = () => init.signal!.removeEventListener('abort', abort);
    }
    options.signal = controller.signal;
  }
  return Promise.resolve(fetch(url.href, options))
    .catch((error) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      throw error;
    })
    .finally(cleanup);
}
/** @internal Hybrid constructor emitted for unbound WebSocket. */
export const HybridWebSocket: typeof WebSocket = new Proxy(function () {}.bind(null) as any, {
  construct(_target, args) {
    const url = new URL(String(args[0]), location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    const origin = new URL(url);
    origin.protocol = origin.protocol === 'wss:' ? 'https:' : 'http:';
    const Constructor =
      origin.origin === location.origin ? state.WebSocket : nativeGlobal('WebSocket');
    return Reflect.construct(Constructor, [url.href, ...args.slice(1)]);
  },
  get(_target, key) {
    return Reflect.get(state.WebSocket, key);
  },
});
