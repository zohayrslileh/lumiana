import stream from 'stream-browserify';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import type { KernelCall } from './filesystem.js';

const { Duplex } = stream;

export type KernelSubscribe = (
  handle: number,
  listener: (event: string, args: any[]) => void,
) => () => void;

const socketOptions = (args: any[]) => {
  if (typeof args[0] === 'object') return { ...args[0] };
  if (typeof args[0] === 'string') return { path: args[0] };
  return { port: args[0], ...(typeof args[1] === 'string' ? { host: args[1] } : {}) };
};

const listenOptions = (args: any[]) => {
  if (typeof args[0] === 'object') return { ...args[0] };
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

export function createNetwork(call: KernelCall, subscribe: KernelSubscribe): any {
  class Socket extends Duplex {
    private handle?: number;
    private release?: () => void;
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
      super({ ...options, emitClose: false });
      if (options.handle !== undefined) this.attach(options.handle, options);
    }

    private attach(handle: number, info: any = {}) {
      this.handle = handle;
      Object.assign(this, info);
      this.pending = false;
      this.readyState = 'open';
      this.release = subscribe(handle, (event, args) => this.incoming(event, args));
      void call('net.resume', handle);
    }

    private incoming(event: string, args: any[]) {
      if (event === 'connect') {
        this.connecting = false;
        this.pending = false;
        this.readyState = 'open';
        Object.assign(this, args[0]);
        this.emit('connect');
      } else if (event === 'ready') this.emit('ready');
      else if (event === 'data') {
        if (!this.push(Buffer.from(args[0]))) void call('net.pause', this.handle);
      } else if (event === 'end') {
        this.readyState = 'writeOnly';
        this.push(null);
      } else if (event === 'error') this.emit('error', error(args[0]));
      else if (event === 'close') {
        this.readyState = 'closed';
        this.release?.();
        this.emit('close', args[0]);
      } else this.emit(event, ...args);
    }

    connect(...args: any[]) {
      const done = callback(args);
      if (done) this.once('connect', done as any);
      this.connecting = true;
      this.pending = true;
      this.readyState = 'opening';
      void call('net.connect', socketOptions(args)).then(
        ({ handle }) => {
          this.handle = handle;
          this.release = subscribe(handle, (event, values) => this.incoming(event, values));
        },
        (reason) => this.emit('error', reason),
      );
      return this;
    }

    _read() {
      if (this.handle !== undefined) void call('net.resume', this.handle);
    }

    _write(chunk: any, encoding: BufferEncoding, done: (error?: Error | null) => void) {
      if (this.handle === undefined) {
        this.once('connect', () => this._write(chunk, encoding, done));
        return;
      }
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
      void call('net.write', this.handle, new Uint8Array(bytes)).then(() => done(), done);
    }

    _final(done: (error?: Error | null) => void) {
      if (this.handle === undefined) {
        done();
        return;
      }
      void call('net.end', this.handle).then(() => done(), done);
    }

    override destroy(error?: Error) {
      if (this.handle !== undefined) void call('net.destroy', this.handle);
      return super.destroy(error);
    }

    setNoDelay(enable = true) {
      if (this.handle !== undefined) void call('net.setNoDelay', this.handle, enable);
      return this;
    }

    setKeepAlive(enable = false, initialDelay = 0) {
      if (this.handle !== undefined)
        void call('net.setKeepAlive', this.handle, enable, initialDelay);
      return this;
    }

    setTimeout(timeout: number, done?: () => void) {
      if (done) this.once('timeout', done);
      if (this.handle !== undefined) void call('net.setTimeout', this.handle, timeout);
      return this;
    }
  }

  class Server extends EventEmitter {
    private handle?: number;
    private release?: () => void;
    private bound: any = null;
    listening = false;

    constructor(options?: any, listener?: (socket: Socket) => void) {
      super();
      if (typeof options === 'function') listener = options;
      if (listener) this.on('connection', listener);
      void call('net.server', typeof options === 'object' ? options : undefined).then(
        ({ handle }) => {
          this.handle = handle;
          this.release = subscribe(handle, (event, args) => this.incoming(event, args));
          this.emit('handle');
        },
        (reason) => this.emit('error', reason),
      );
    }

    private incoming(event: string, args: any[]) {
      if (event === 'connection') this.emit('connection', new Socket(args[0]));
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
  return { Socket, Server, createServer, createConnection, connect: createConnection };
}
