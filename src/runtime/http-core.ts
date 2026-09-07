import { STATUS_CODES } from './http-status.js';
import stream from './stream.js';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { HTTPParser } from 'http-parser-js';
import type { KernelCall } from './filesystem.js';
import { createNetwork, type KernelSubscribe } from './network.js';

function headersFrom(raw: string[]) {
  const headers: any = Object.create(null),
    distinct: any = Object.create(null);
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index].toLowerCase(),
      value = raw[index + 1];
    (distinct[name] ??= []).push(value);
    if (name === 'set-cookie') (headers[name] ??= []).push(value);
    else
      headers[name] =
        headers[name] === undefined
          ? value
          : headers[name] + (name === 'cookie' ? '; ' : ', ') + value;
  }
  return { headers, distinct };
}

/** HTTP parsing, response framing, and pipeline ordering belong to the local runtime. */
export function createHttp(
  call: KernelCall,
  subscribe: KernelSubscribe,
  transport = createNetwork(call, subscribe),
): any {
  class IncomingMessage extends stream.Readable {
    aborted = false;
    complete = false;
    method?: string;
    url?: string;
    headers: any = {};
    headersDistinct: any = {};
    rawHeaders: string[] = [];
    trailers: any = {};
    rawTrailers: string[] = [];
    httpVersion = '1.1';
    httpVersionMajor = 1;
    httpVersionMinor = 1;
    socket: any;
    connection: any;
    constructor(socket: any, info?: any) {
      super({ autoDestroy: true });
      this.socket = this.connection = socket;
      if (info) {
        this.method = HTTPParser.methods[info.method];
        this.url = info.url;
        this.rawHeaders = info.headers;
        const parsed = headersFrom(info.headers);
        this.headers = parsed.headers;
        this.headersDistinct = parsed.distinct;
        this.httpVersionMajor = info.versionMajor;
        this.httpVersionMinor = info.versionMinor;
        this.httpVersion = `${info.versionMajor}.${info.versionMinor}`;
      }
    }
    _read() {
      this.socket.resume();
    }
    _destroy(error: Error | null, done: (error?: Error | null) => void) {
      if (!this.complete) {
        this.aborted = true;
        this.emit('aborted');
        this.socket.destroy();
      }
      done(error);
    }
    setTimeout(milliseconds: number, callback?: any) {
      this.socket.setTimeout(milliseconds, callback);
      return this;
    }
  }
  class ServerResponse extends stream.Writable {
    statusCode = 200;
    statusMessage?: string;
    sendDate = true;
    strictContentLength = false;
    req: IncomingMessage;
    socket: any;
    connection: any;
    private headers: Record<string, any> = Object.create(null);
    private sent = false;
    private chunked = false;
    private noBody = false;
    private trailers: any = {};
    private ended = false;
    constructor(
      request: IncomingMessage,
      private owner: Connection,
      readonly keepAlive: boolean,
    ) {
      super({ autoDestroy: true });
      this.req = request;
      this.socket = this.connection = request.socket;
      this.once('finish', () => {
        this.ended = true;
        this.owner.finished(this);
      });
    }
    get headersSent() {
      return this.sent;
    }
    get finished() {
      return this.ended;
    }
    setHeader(name: string, value: any) {
      if (this.sent) throw new Error('Cannot set headers after they are sent');
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        value === undefined ||
        /[\0\r\n]/.test(String(value))
      )
        throw new TypeError('Invalid HTTP header');
      this.headers[name.toLowerCase()] = value;
      return this;
    }
    appendHeader(name: string, value: any) {
      const key = name.toLowerCase();
      return this.setHeader(
        name,
        this.headers[key] === undefined ? value : ([] as any[]).concat(this.headers[key], value),
      );
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
    writeHead(statusCode: number, statusMessage?: any, headers?: any) {
      this.statusCode = statusCode;
      if (typeof statusMessage === 'string') this.statusMessage = statusMessage;
      else headers = statusMessage;
      if (Array.isArray(headers))
        for (let i = 0; i < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
      else for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value);
      return this;
    }
    private head(length?: number) {
      if (this.sent) return Buffer.alloc(0);
      if (!Number.isInteger(this.statusCode) || this.statusCode < 100 || this.statusCode > 999)
        throw new RangeError('Invalid HTTP status code');
      this.noBody =
        this.req.method === 'HEAD' || this.statusCode < 200 || [204, 304].includes(this.statusCode);
      if (this.sendDate && !this.hasHeader('date'))
        this.setHeader('date', new Date().toUTCString());
      if (!this.hasHeader('connection'))
        this.setHeader(
          'connection',
          this.keepAlive && !this.owner.server.closing ? 'keep-alive' : 'close',
        );
      if (
        !this.noBody &&
        !this.hasHeader('content-length') &&
        !this.hasHeader('transfer-encoding')
      ) {
        if (length !== undefined && !Object.keys(this.trailers).length)
          this.setHeader('content-length', length);
        else this.setHeader('transfer-encoding', 'chunked');
      }
      this.chunked =
        !this.noBody && String(this.getHeader('transfer-encoding')).toLowerCase() === 'chunked';
      this.sent = true;
      const reason = this.statusMessage ?? STATUS_CODES[this.statusCode] ?? 'unknown';
      let text = `HTTP/1.1 ${this.statusCode} ${reason}\r\n`;
      for (const [name, values] of Object.entries(this.headers))
        for (const value of Array.isArray(values) ? values : [values])
          text += `${name}: ${value}\r\n`;
      return Buffer.from(text + '\r\n');
    }
    flushHeaders() {
      this.owner.write(this, this.head(), (error?: Error | null) => {
        if (error) this.destroy(error);
      });
    }
    addTrailers(headers: any) {
      Object.assign(this.trailers, headers);
    }
    writeContinue(callback?: any) {
      this.owner.write(this, Buffer.from('HTTP/1.1 100 Continue\r\n\r\n'), callback ?? (() => {}));
    }
    writeProcessing() {
      this.owner.write(this, Buffer.from('HTTP/1.1 102 Processing\r\n\r\n'), () => {});
    }
    _write(chunk: any, encoding: BufferEncoding, done: any) {
      const bytes = Buffer.from(chunk, encoding),
        head = this.head();
      this.owner.write(
        this,
        Buffer.concat([
          head,
          ...(this.noBody
            ? []
            : this.chunked
              ? bytes.length
                ? [Buffer.from(bytes.length.toString(16) + '\r\n'), bytes, Buffer.from('\r\n')]
                : []
              : [bytes]),
        ]),
        done,
      );
    }
    _final(done: any) {
      const head = this.head(0);
      let trailers = '';
      for (const [name, value] of Object.entries(this.trailers))
        trailers += `${name}: ${value}\r\n`;
      this.owner.write(
        this,
        Buffer.concat([
          head,
          this.chunked ? Buffer.from('0\r\n' + trailers + '\r\n') : Buffer.alloc(0),
        ]),
        done,
      );
      this.req.resume();
    }
    _destroy(error: Error | null, done: any) {
      if (!this.ended) this.socket.destroy();
      done(error);
    }
    setTimeout(milliseconds: number, callback?: any) {
      this.socket.setTimeout(milliseconds, callback);
      return this;
    }
  }
  class Connection {
    private parser = new HTTPParser(HTTPParser.REQUEST);
    private current?: IncomingMessage;
    private upgraded?: IncomingMessage;
    private queue: ServerResponse[] = [];
    private writes = new Map<ServerResponse, { bytes: Buffer; done: any }[]>();
    constructor(
      readonly server: Server,
      readonly socket: any,
    ) {
      this.parser.maxHeaderSize = server.options.maxHeaderSize ?? 16384;
      this.parser[HTTPParser.kOnHeadersComplete] = (info) => {
        const request = new IncomingMessage(socket, info);
        this.current = request;
        if (info.upgrade || request.method === 'CONNECT') {
          this.upgraded = request;
          return 2;
        }
        const response = new ServerResponse(request, this, info.shouldKeepAlive);
        this.queue.push(response);
        if (request.headers.expect?.toLowerCase() === '100-continue') {
          if (!server.emit('checkContinue', request, response)) {
            response.writeContinue();
            server.emit('request', request, response);
          }
        } else server.emit('request', request, response);
      };
      this.parser[HTTPParser.kOnBody] = (bytes, offset, length) => {
        if (!this.current?.push(Buffer.from(bytes.subarray(offset, offset + length))))
          socket.pause();
      };
      this.parser[HTTPParser.kOnHeaders] = (raw) => {
        if (this.current) {
          this.current.rawTrailers = raw;
          this.current.trailers = headersFrom(raw).headers;
        }
      };
      this.parser[HTTPParser.kOnMessageComplete] = () => {
        if (this.current) {
          this.current.complete = true;
          this.current.push(null);
          this.current = undefined;
        }
      };
      socket.on('data', this.data);
      socket.on('end', this.end);
      socket.on('error', this.failed);
      socket.on('close', this.closed);
    }
    get idle() {
      return this.queue.length === 0 && !this.current;
    }
    private data = (bytes: Buffer) => {
      let consumed;
      try {
        consumed = this.parser.execute(Buffer.from(bytes));
      } catch (error) {
        this.failed(error as Error);
        return;
      }
      if (consumed instanceof Error) {
        this.failed(consumed);
        return;
      }
      if (this.upgraded) {
        const request = this.upgraded;
        request.complete = true;
        this.socket.off('data', this.data);
        this.socket.off('end', this.end);
        this.socket.off('error', this.failed);
        this.socket.off('close', this.closed);
        this.server.connections.delete(this);
        if (
          !this.server.emit(
            request.method === 'CONNECT' ? 'connect' : 'upgrade',
            request,
            this.socket,
            bytes.subarray(consumed),
          )
        )
          this.socket.destroy();
      }
    };
    private end = () => {
      const error = this.parser.finish();
      if (error) this.failed(error);
    };
    private failed = (error: Error) => {
      if (!this.server.emit('clientError', error, this.socket)) this.socket.destroy();
    };
    private closed = () => {
      this.server.connections.delete(this);
      this.current?.destroy();
      for (const response of this.queue.splice(0)) response.destroy();
    };
    write(response: ServerResponse, bytes: Buffer, done: any) {
      if (this.socket.destroyed) {
        done(new Error('Socket is closed'));
        return;
      }
      if (this.queue[0] !== response) {
        const pending = this.writes.get(response) ?? [];
        pending.push({ bytes, done });
        this.writes.set(response, pending);
        return;
      }
      if (bytes.length) this.socket.write(bytes, done);
      else done();
    }
    finished(response: ServerResponse) {
      if (this.queue[0] === response) this.queue.shift();
      if (String(response.getHeader('connection')).toLowerCase() === 'close' || this.server.closing)
        this.socket.end();
      else {
        const next = this.queue[0];
        for (const pending of this.writes.get(next) ?? [])
          this.write(next, pending.bytes, pending.done);
        this.writes.delete(next);
        if (this.idle)
          this.socket.setTimeout(this.server.keepAliveTimeout, () => {
            if (this.idle) this.socket.destroy();
          });
      }
    }
  }
  class Server extends EventEmitter {
    readonly transport: any;
    readonly connections = new Set<Connection>();
    readonly options: any;
    closing = false;
    keepAliveTimeout = 5000;
    headersTimeout = 60000;
    requestTimeout = 300000;
    constructor(options?: any, listener?: any) {
      super();
      if (typeof options === 'function') {
        listener = options;
        options = {};
      }
      this.options = options ?? {};
      Object.assign(this, {
        keepAliveTimeout: this.options.keepAliveTimeout ?? 5000,
        headersTimeout: this.options.headersTimeout ?? 60000,
        requestTimeout: this.options.requestTimeout ?? 300000,
      });
      if (listener) this.on('request', listener);
      this.transport = transport.createServer(this.options, (socket: any) => this.accept(socket));
      for (const event of [
        'handle',
        'listening',
        'error',
        'close',
        'tlsClientError',
        'secureConnection',
      ])
        this.transport.on(event, (...args: any[]) => this.emit(event, ...args));
    }
    accept(socket: any) {
      socket.setTimeout(0);
      this.connections.add(new Connection(this, socket));
      this.emit('connection', socket);
    }
    get listening() {
      return this.transport.listening;
    }
    listen(...args: any[]) {
      this.closing = false;
      this.transport.listen(...args);
      return this;
    }
    address() {
      return this.transport.address();
    }
    close(callback?: any) {
      this.closing = true;
      this.closeIdleConnections();
      this.transport.close(callback);
      return this;
    }
    closeAllConnections() {
      for (const connection of this.connections) connection.socket.destroy();
    }
    closeIdleConnections() {
      for (const connection of this.connections) if (connection.idle) connection.socket.destroy();
    }
    ref() {
      this.transport.ref();
      return this;
    }
    unref() {
      this.transport.unref();
      return this;
    }
    setTimeout(milliseconds: number, callback?: any) {
      for (const connection of this.connections)
        connection.socket.setTimeout(milliseconds, callback);
      return this;
    }
    addContext(...args: any[]) {
      return this.transport.addContext(...args);
    }
    setSecureContext(...args: any[]) {
      return this.transport.setSecureContext(...args);
    }
    getTicketKeys() {
      return this.transport.getTicketKeys();
    }
    setTicketKeys(...args: any[]) {
      return this.transport.setTicketKeys(...args);
    }
  }
  for (const [value, name] of [
    [IncomingMessage, 'IncomingMessage'],
    [ServerResponse, 'ServerResponse'],
    [Server, 'Server'],
  ] as const)
    Object.defineProperty(value, 'name', { value: name });
  return {
    Server,
    IncomingMessage,
    ServerResponse,
    accept: (server: any, socket: any) => {
      server.connections.add(new Connection(server, socket));
    },
    createServer: (options?: any, listener?: any) => new Server(options, listener),
  };
}
