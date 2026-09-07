import stream from './stream.js';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import type { KernelCall } from './filesystem.js';

const { Duplex } = stream;

export type KernelSubscribe = (
  handle: number,
  listener: (event: string, args: any[]) => void,
) => () => void;

export const socketOptions = (args: any[]) => {
  if (typeof args[0] === 'object')
    return Object.fromEntries(
      [
        'port',
        'host',
        'path',
        'localAddress',
        'localPort',
        'family',
        'hints',
        'autoSelectFamily',
        'autoSelectFamilyAttemptTimeout',
        'noDelay',
        'keepAlive',
        'keepAliveInitialDelay',
        'timeout',
      ]
        .filter((key) => args[0][key] !== undefined)
        .map((key) => [key, args[0][key]]),
    );
  if (typeof args[0] === 'string') return { path: args[0] };
  return { port: args[0], ...(typeof args[1] === 'string' ? { host: args[1] } : {}) };
};

const selectedOptions = (source: any, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]),
  );

const serverOptions = (options: any) =>
  selectedOptions(options, [
    'allowHalfOpen',
    'pauseOnConnect',
    'noDelay',
    'keepAlive',
    'keepAliveInitialDelay',
    'highWaterMark',
  ]);

const listenOptions = (args: any[]) => {
  if (args[0] && typeof args[0] === 'object')
    return selectedOptions(args[0], [
      'port',
      'host',
      'path',
      'backlog',
      'exclusive',
      'ipv6Only',
      'reusePort',
      'readableAll',
      'writableAll',
    ]);
  if (typeof args[0] === 'string') return { path: args[0] };
  return {
    port: args[0],
    ...(typeof args[1] === 'string' ? { host: args[1] } : {}),
    ...(typeof args[1] === 'number' ? { backlog: args[1] } : {}),
    ...(typeof args[2] === 'number' ? { backlog: args[2] } : {}),
  };
};

const callback = (args: any[]) =>
  [...args].reverse().find((value) => typeof value === 'function') as Function | undefined;

const error = (value: any) => Object.assign(new Error(value.message), value);

export function createNetwork(
  call: KernelCall,
  subscribe: KernelSubscribe,
  sync?: (operation: string, ...args: any[]) => any,
): any {
  const socketObjects = new Map<number, Socket>();
  const takeHandles = new WeakMap<object, () => Promise<number>>();
  class Socket extends Duplex {
    protected handle?: number;
    protected release?: () => void;
    private opening = false;
    private nativeClosed = false;
    private hadError = false;
    private destroyDone?: (error?: Error | null) => void;
    private destroyReason: Error | null = null;
    private settings = new Map<string, any[]>();
    protected writableReady = false;
    connecting = false;
    pending = true;
    readyState: 'opening' | 'open' | 'readOnly' | 'writeOnly' | 'closed' = 'closed';
    localAddress?: string;
    localPort?: number;
    localFamily?: string;
    remoteAddress?: string;
    remotePort?: number;
    remoteFamily?: string;

    constructor(options: any = {}) {
      super({ autoDestroy: true, ...options, emitClose: true });
      takeHandles.set(this, async () => {
        if (this.handle === undefined)
          await new Promise<void>((resolve, reject) => {
            const attached = () => {
              this.off('error', failed);
              resolve();
            };
            const failed = (error: Error) => {
              this.off('_handle', attached);
              reject(error);
            };
            this.once('_handle', attached);
            this.once('error', failed);
          });
        const handle = this.handle!;
        this.release?.();
        socketObjects.delete(handle);
        this.handle = undefined;
        this.writableReady = false;
        return handle;
      });
      if (options.handle !== undefined) this.attach(options.handle, options);
    }

    protected attach(handle: number, info: any = {}) {
      this.handle = handle;
      socketObjects.set(handle, this);
      Object.assign(this, info);
      this.pending = false;
      this.readyState = 'open';
      this.writableReady = true;
      this.release = subscribe(handle, (event, args) => this.incoming(event, args));
      void call('net.resume', handle);
    }

    protected incoming(event: string, args: any[]) {
      if (event === 'connect') {
        this.connecting = false;
        this.pending = false;
        this.readyState = 'open';
        Object.assign(this, args[0]);
        this.writableReady = true;
        this.emit('connect');
        this.emit('_connected');
      } else if (event === 'ready') this.emit('ready');
      else if (event === 'data') {
        if (!this.push(Buffer.from(args[0]))) void call('net.pause', this.handle);
      } else if (event === 'end') {
        this.readyState = 'writeOnly';
        this.push(null);
      } else if (event === 'error') this.destroy(error(args[0]));
      else if (event === 'close') {
        this.writableReady = false;
        this.readyState = 'closed';
        if (this.handle !== undefined) socketObjects.delete(this.handle);
        this.nativeClosed = true;
        this.hadError ||= Boolean(args[0]);
        this.release?.();
        if (this.destroyDone) {
          const done = this.destroyDone;
          this.destroyDone = undefined;
          done(this.destroyReason);
        } else this.destroy();
      } else this.emit(event, ...args);
    }

    connect(...args: any[]) {
      const done = callback(args);
      if (done) this.once('connect', done as any);
      return this.open('net.connect', socketOptions(args));
    }

    protected open(operation: string, options: any) {
      this.opening = true;
      this.nativeClosed = false;
      this.writableReady = false;
      this.connecting = true;
      this.pending = true;
      this.readyState = 'opening';
      void call(operation, options).then(
        ({ handle }) => {
          this.opening = false;
          this.handle = handle;
          socketObjects.set(handle, this);
          this.release = subscribe(handle, (event, values) => this.incoming(event, values));
          if (this.destroyed) {
            void call('net.destroy', handle);
            return;
          }
          for (const [name, values] of this.settings) this.configure(name, ...values);
          this.settings.clear();
          this.emit('_handle');
        },
        (reason) => {
          this.opening = false;
          if (this.destroyDone) {
            const done = this.destroyDone;
            this.destroyDone = undefined;
            done(this.destroyReason ?? reason);
          } else this.destroy(reason);
        },
      );
      return this;
    }

    _read() {
      if (this.handle !== undefined) void call('net.resume', this.handle);
    }

    _write(chunk: any, encoding: BufferEncoding, done: (error?: Error | null) => void) {
      if (!this.writableReady) {
        const ready = () => {
          cleanup();
          this._write(chunk, encoding, done);
        };
        const failed = (reason: Error) => {
          cleanup();
          done(reason);
        };
        const closed = () =>
          failed(
            Object.assign(new Error('Socket closed before connecting'), {
              code: 'ERR_SOCKET_CLOSED',
            }),
          );
        const cleanup = () => {
          this.off('_connected', ready);
          this.off('error', failed);
          this.off('close', closed);
        };
        this.once('_connected', ready);
        this.once('error', failed);
        this.once('close', closed);
        return;
      }
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
      if (!bytes.length) {
        done();
        return;
      }
      void call('net.write', this.handle, new Uint8Array(bytes)).then(() => done(), done);
    }

    _writev(
      chunks: { chunk: Buffer; encoding: BufferEncoding }[],
      done: (error?: Error | null) => void,
    ) {
      this._write(
        Buffer.concat(
          chunks.map(({ chunk, encoding }) =>
            typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk),
          ),
        ),
        'buffer' as BufferEncoding,
        done,
      );
    }

    address() {
      return this.localAddress
        ? { address: this.localAddress, family: this.localFamily, port: this.localPort }
        : {};
    }

    ref() {
      if (this.handle !== undefined) void call('net.ref', this.handle);
      return this;
    }
    unref() {
      if (this.handle !== undefined) void call('net.unref', this.handle);
      return this;
    }

    _final(done: (error?: Error | null) => void) {
      if (!this.writableReady) {
        this._write(Buffer.alloc(0), 'buffer' as BufferEncoding, (error) =>
          error ? done(error) : this._final(done),
        );
        return;
      }
      void call('net.end', this.handle).then(() => done(), done);
    }

    _destroy(error: Error | null, done: (error?: Error | null) => void) {
      this.hadError ||= Boolean(error);
      this.destroyReason = error;
      if (this.nativeClosed || (this.handle === undefined && !this.opening)) {
        this.release?.();
        done(error);
      } else {
        this.destroyDone = done;
        if (this.handle !== undefined) void call('net.destroy', this.handle).catch(done);
      }
    }

    override emit(event: string | symbol, ...args: any[]): boolean {
      return super.emit(event, ...(event === 'close' ? [this.hadError] : args));
    }

    setNoDelay(enable = true) {
      this.configure('net.setNoDelay', enable);
      return this;
    }

    setKeepAlive(enable = false, initialDelay = 0) {
      this.configure('net.setKeepAlive', enable, initialDelay);
      return this;
    }

    setTimeout(timeout: number, done?: () => void) {
      if (done) this.once('timeout', done);
      this.configure('net.setTimeout', timeout);
      return this;
    }

    private configure(name: string, ...values: any[]) {
      if (this.handle === undefined) this.settings.set(name, values);
      else if (!this.destroyed)
        void call(name, this.handle, ...values).catch((reason) => this.destroy(reason));
    }
  }

  class Server extends EventEmitter {
    private handle?: number;
    private release?: () => void;
    private bound: any = null;
    listening = false;

    constructor(
      options?: any,
      listener?: (socket: Socket) => void,
      private transport = { operation: 'net.server', event: 'connection', Socket },
    ) {
      super();
      if (typeof options === 'function') listener = options;
      if (listener) this.on(transport.event, listener);
      const attach = ({ handle }: { handle: number }) => {
        this.handle = handle;
        this.release = subscribe(handle, (event, args) => this.incoming(event, args));
        this.emit('handle');
      };
      const input =
        options && typeof options === 'object'
          ? transport.operation === 'net.server'
            ? serverOptions(options)
            : options
          : undefined;
      if (sync && transport.operation === 'tls.server') attach(sync(transport.operation, input));
      else
        void call(transport.operation, input).then(attach, (reason) => this.emit('error', reason));
    }

    private incoming(event: string, args: any[]) {
      if (event === this.transport.event)
        this.emit(event, socketFor(args[0], this.transport.Socket));
      else if (event === 'tlsClientError') this.emit(event, error(args[0]));
      else if (event === 'listening') {
        this.bound = args[0];
        this.listening = true;
        this.emit('listening');
      } else if (event === 'close') {
        this.listening = false;
        this.release?.();
        this.emit('close');
      } else if (event === 'error') this.emit('error', error(args[0]));
      else this.emit(event, ...args);
    }

    listen(...args: any[]) {
      const done = callback(args);
      if (done) this.once('listening', done as any);
      const start = () => void call('net.listen', this.handle, listenOptions(args));
      if (this.handle === undefined) this.once('handle', start);
      else start();
      return this;
    }

    address() {
      return this.bound;
    }

    close(done?: (error?: Error) => void) {
      if (done) this.once('close', done as any);
      if (this.handle === undefined) throw new Error('Server is not running');
      void call('net.server.close', this.handle).catch((reason) => this.emit('error', reason));
      return this;
    }

    ref() {
      if (this.handle !== undefined) void call('net.server.ref', this.handle);
      return this;
    }

    unref() {
      if (this.handle !== undefined) void call('net.server.unref', this.handle);
      return this;
    }
  }

  Object.defineProperty(Socket, 'name', { value: 'Socket' });
  Object.defineProperty(Server, 'name', { value: 'Server' });

  const createServer = (options?: any, listener?: any) => new Server(options, listener);
  const createConnection = (...args: any[]) => new Socket().connect(...args);
  const socketFor = (info: any, Constructor = Socket) => {
    const existing = socketObjects.get(info.handle);
    if (existing) {
      Object.assign(existing, info);
      return existing;
    }
    return new Constructor(info);
  };
  const takeSocket = (socket: object) => {
    const take = takeHandles.get(socket);
    if (!take) throw new TypeError('TLS requires a socket from the same Node runtime');
    return take();
  };
  return {
    Socket,
    Server,
    createServer,
    createConnection,
    connect: createConnection,
    takeSocket,
    socketFor,
  };
}
