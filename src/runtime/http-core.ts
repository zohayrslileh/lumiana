import stream from 'stream-browserify';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import type { KernelCall } from './filesystem.js';
import { createNetwork, type KernelSubscribe } from './network.js';

const { Readable, Writable } = stream;
const error = (value: any) => Object.assign(new Error(value.message), value);
const finalCallback = (args: any[]) =>
  [...args].reverse().find((value) => typeof value === 'function') as Function | undefined;

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

export function createHttp(call: KernelCall, subscribe: KernelSubscribe): any {
  const { Socket } = createNetwork(call, subscribe);
  class Connection extends EventEmitter {
    destroyed = false;
    connecting = false;
    readable = true;
    writable = true;
    encrypted = false;
    constructor(info: any) {
      super();
      Object.assign(this, info);
    }
    setTimeout(_timeout: number, done?: () => void) {
      if (done) this.once('timeout', done);
      return this;
    }
    setNoDelay() {
      return this;
    }
    setKeepAlive() {
      return this;
    }
    ref() {
      return this;
    }
    unref() {
      return this;
    }
  }

  class IncomingMessage extends Readable {
    aborted = false;
    complete = false;
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    headersDistinct: Record<string, string[]>;
    rawHeaders: string[];
    trailers: Record<string, string | undefined>;
    rawTrailers: string[];
    httpVersion: string;
    httpVersionMajor: number;
    httpVersionMinor: number;
    socket: Connection;
    connection: Connection;
    private release: () => void;

    constructor(
      private handle: number,
      info: any,
    ) {
      super({ emitClose: false });
      this.method = info.method;
      this.url = info.url;
      this.headers = info.headers;
      this.headersDistinct = info.headersDistinct;
      this.rawHeaders = info.rawHeaders;
      this.trailers = info.trailers;
      this.rawTrailers = info.rawTrailers;
      this.httpVersion = info.httpVersion;
      this.httpVersionMajor = info.httpVersionMajor;
      this.httpVersionMinor = info.httpVersionMinor;
      this.complete = info.complete;
      this.socket = this.connection = new Connection(info.socket);
      this.release = subscribe(handle, (event, args) => this.incoming(event, args));
      void call('http.request.resume', handle);
    }

    private incoming(event: string, args: any[]) {
      if (event === 'data') {
        if (!this.push(Buffer.from(args[0]))) void call('http.request.pause', this.handle);
      } else if (event === 'end') {
        this.complete = true;
        this.push(null);
      } else if (event === 'aborted') {
        this.aborted = true;
        this.emit('aborted');
      } else if (event === 'error') this.emit('error', error(args[0]));
      else if (event === 'close') {
        this.release();
        // The transport may deliver end and close in the same batch. Readable
        // emits end only after its local buffer has been consumed.
        if (this.complete && !this.readableEnded) this.once('end', () => this.emit('close'));
        else this.emit('close');
      }
    }

    _read() {
      void call('http.request.resume', this.handle);
    }

    override destroy(reason?: Error) {
      void call('http.request.destroy', this.handle);
      return super.destroy(reason);
    }
  }

  class ServerResponse extends Writable {
    statusCode = 200;
    statusMessage?: string;
    sendDate = true;
    strictContentLength = false;
    req: IncomingMessage;
    socket: Connection;
    connection: Connection;
    private headers: Record<string, string | string[]> = Object.create(null);
    private sent = false;
    private nativeFinished = false;
    private release: () => void;

    constructor(
      private handle: number,
      request: IncomingMessage,
    ) {
      super({ emitClose: false });
      this.req = request;
      this.socket = this.connection = request.socket;
      this.release = subscribe(handle, (event, args) => {
        if (event === 'finish') this.nativeFinished = true;
        else if (event === 'close') {
          this.release();
          if (this.nativeFinished && !this.writableFinished)
            this.once('finish', () => this.emit('close'));
          else this.emit('close');
        } else if (event === 'error') this.emit('error', error(args[0]));
      });
    }

    get headersSent() {
      return this.sent;
    }

    get finished() {
      return this.writableEnded;
    }

    setHeader(name: string, value: any) {
      if (this.sent) throw new Error('Cannot set headers after they are sent');
      this.headers[name.toLowerCase()] = value;
      return this;
    }
    appendHeader(name: string, value: any) {
      const key = name.toLowerCase();
      const previous = this.headers[key];
      this.headers[key] = previous === undefined ? value : ([] as any[]).concat(previous, value);
      return this;
    }
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    }
    getHeaders() {
      return { ...this.headers };
    }
    getHeaderNames() {
      return Object.keys(this.headers);
    }
    hasHeader(name: string) {
      return Object.hasOwn(this.headers, name.toLowerCase());
    }
    removeHeader(name: string) {
      if (this.sent) throw new Error('Cannot remove headers after they are sent');
      delete this.headers[name.toLowerCase()];
    }
    writeHead(statusCode: number, statusMessage?: string | Record<string, any>, headers?: any) {
      this.statusCode = statusCode;
      if (typeof statusMessage === 'string') this.statusMessage = statusMessage;
      else headers = statusMessage;
      if (headers) {
        if (Array.isArray(headers))
          for (let index = 0; index < headers.length; index += 2)
            this.setHeader(headers[index], headers[index + 1]);
        else for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
      }
      return this;
    }
    flushHeaders() {
      if (this.sent) return;
      this.sent = true;
      void call('http.response.flush', this.handle, this.state());
    }
    addTrailers(headers: Record<string, string>) {
      void call('http.response.trailers', this.handle, headers);
    }
    private state() {
      return {
        statusCode: this.statusCode,
        statusMessage: this.statusMessage,
        headers: this.headers,
      };
    }
    _write(chunk: any, encoding: BufferEncoding, done: (error?: Error | null) => void) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
      const state = this.sent ? undefined : this.state();
      this.sent = true;
      void call('http.response.write', this.handle, new Uint8Array(bytes), state).then(
        () => done(),
        done,
      );
    }
    _final(done: (error?: Error | null) => void) {
      const state = this.sent ? undefined : this.state();
      this.sent = true;
      void call('http.response.end', this.handle, undefined, state).then(() => done(), done);
    }
    override destroy(reason?: Error) {
      void call('http.response.destroy', this.handle);
      return super.destroy(reason);
    }
  }

  class Server extends EventEmitter {
    listening = false;
    private handle?: number;
    private bound: any = null;
    private release?: () => void;
    constructor(
      options?: any,
      listener?: (request: IncomingMessage, response: ServerResponse) => void,
    ) {
      super();
      if (typeof options === 'function') listener = options;
      if (listener) this.on('request', listener);
      void call('http.server', typeof options === 'object' ? options : undefined).then(
        ({ handle }) => {
          this.handle = handle;
          this.release = subscribe(handle, (event, args) => this.incoming(event, args));
          this.emit('handle');
        },
        (reason) => this.emit('error', reason),
      );
    }
    private incoming(event: string, args: any[]) {
      if (event === 'upgrade' || event === 'connect') {
        const info = args[0];
        const socket = new Socket(info.socket);
        const request = new Readable({ read() {} });
        Object.assign(request, info, { socket, connection: socket });
        if (!this.emit(event, request, socket, Buffer.from(info.head))) socket.destroy();
      } else if (event === 'request') {
        const info = args[0];
        const request = new IncomingMessage(info.request, info);
        const response = new ServerResponse(info.response, request);
        this.emit('request', request, response);
      } else if (event === 'listening') {
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
      const done = finalCallback(args);
      if (done) this.once('listening', done as any);
      const start = () => void call('http.listen', this.handle, listenOptions(args));
      if (this.handle === undefined) this.once('handle', start);
      else start();
      return this;
    }
    address() {
      return this.bound;
    }
    close(done?: () => void) {
      if (done) this.once('close', done);
      if (this.handle === undefined) throw new Error('Server is not running');
      void call('http.server.close', this.handle).catch((reason) => this.emit('error', reason));
      return this;
    }
    closeAllConnections() {
      if (this.handle !== undefined) void call('http.server.closeAllConnections', this.handle);
    }
    closeIdleConnections() {
      if (this.handle !== undefined) void call('http.server.closeIdleConnections', this.handle);
    }
    ref() {
      if (this.handle !== undefined) void call('http.server.ref', this.handle);
      return this;
    }
    unref() {
      if (this.handle !== undefined) void call('http.server.unref', this.handle);
      return this;
    }
  }

  for (const [constructor, name] of [
    [Connection, 'Socket'],
    [IncomingMessage, 'IncomingMessage'],
    [ServerResponse, 'ServerResponse'],
    [Server, 'Server'],
  ] as const)
    Object.defineProperty(constructor, 'name', { value: name });

  const createServer = (options?: any, listener?: any) => new Server(options, listener);
  return { Server, IncomingMessage, ServerResponse, createServer };
}
