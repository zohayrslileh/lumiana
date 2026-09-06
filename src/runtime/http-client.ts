import stream from 'stream-browserify';
import { Buffer } from 'buffer';
import { HTTPParser } from 'http-parser-js';
import { createNetwork, type KernelSubscribe } from './network.js';
import type { KernelCall } from './filesystem.js';

/** HTTP framing stays local; the transport owns only the underlying byte stream. */
export function createHttpClient(call: KernelCall, subscribe: KernelSubscribe): any {
  const { createConnection } = createNetwork(call, subscribe);
  class ClientRequest extends stream.Writable {
    socket: any;
    connection: any;
    method: string;
    path: string;
    host: string;
    protocol = 'http:';
    aborted = false;
    headersSent = false;
    private headers = new Map<string, { name: string; value: any }>();
    private chunked = false;
    private upgraded = false;
    private response: any;
    private parser = new HTTPParser(HTTPParser.RESPONSE);
    constructor(options: any, callback?: Function) {
      super({ autoDestroy: false });
      if (options.protocol && options.protocol !== 'http:')
        throw Object.assign(
          new TypeError(`Protocol ${options.protocol} is not supported by http`),
          { code: 'ERR_INVALID_PROTOCOL' },
        );
      this.method = String(options.method ?? 'GET').toUpperCase();
      this.path = options.path ?? '/';
      this.host = options.hostname ?? options.host ?? 'localhost';
      if (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(this.method) || /[^\x21-\xff]/.test(this.path))
        throw new TypeError('Invalid HTTP method or request path');
      for (const [name, value] of Object.entries(options.headers ?? {}))
        this.setHeader(name, value);
      if (!this.hasHeader('host'))
        this.setHeader(
          'Host',
          this.host + (options.port && Number(options.port) !== 80 ? `:${options.port}` : ''),
        );
      if (options.auth && !this.hasHeader('authorization'))
        this.setHeader('Authorization', `Basic ${Buffer.from(options.auth).toString('base64')}`);
      if (callback) this.once('response', callback as any);
      this.parser.maxHeaderSize = options.maxHeaderSize ?? 16384;
      this.parser[HTTPParser.kOnHeadersComplete] = (info) => {
        const response: any = new stream.Readable({ read: () => this.socket.resume() });
        Object.assign(response, {
          statusCode: info.statusCode,
          statusMessage: info.statusMessage,
          httpVersion: `${info.versionMajor}.${info.versionMinor}`,
          httpVersionMajor: info.versionMajor,
          httpVersionMinor: info.versionMinor,
          headers: {},
          rawHeaders: info.headers,
          trailers: {},
          rawTrailers: [],
          socket: this.socket,
          connection: this.socket,
          req: this,
          complete: false,
          aborted: false,
        });
        for (let i = 0; i < info.headers.length; i += 2) {
          const name = info.headers[i].toLowerCase(),
            value = info.headers[i + 1];
          if (name === 'set-cookie') (response.headers[name] ??= []).push(value);
          else
            response.headers[name] =
              response.headers[name] === undefined ? value : `${response.headers[name]}, ${value}`;
        }
        if (info.statusCode < 200 && info.statusCode !== 101) {
          if (info.statusCode === 100) this.emit('continue');
          this.emit('information', response);
          return 1;
        }
        this.response = response;
        if (info.upgrade || (this.method === 'CONNECT' && info.statusCode === 200)) {
          this.upgraded = true;
          return 2;
        }
        this.emit('response', response);
        if (this.method === 'HEAD') return 1;
      };
      this.parser[HTTPParser.kOnBody] = (bytes, offset, length) => {
        if (!this.response?.push(Buffer.from(bytes.subarray(offset, offset + length))))
          this.socket.pause();
      };
      this.parser[HTTPParser.kOnHeaders] = (headers) => {
        if (!this.response) return;
        this.response.rawTrailers = headers;
        for (let i = 0; i < headers.length; i += 2)
          this.response.trailers[headers[i].toLowerCase()] = headers[i + 1];
      };
      this.parser[HTTPParser.kOnMessageComplete] = () => {
        if (!this.response || this.upgraded) return;
        this.response.complete = true;
        this.response.push(null);
        this.socket.end();
      };
      // Defer socket creation so listeners can observe synchronous connection failures too.
      queueMicrotask(() => {
        if (this.destroyed) return;
        try {
          this.socket = this.connection = (options.createConnection ?? createConnection)({
            ...options,
            host: this.host,
            port: options.port ?? 80,
            path: options.socketPath,
          });
          this.socket.on('data', this.onData);
          this.socket.on('error', (error: Error) => this.destroy(error));
          this.socket.on('end', () => {
            if (this.upgraded) return;
            const error = this.parser.finish();
            if (error) this.destroy(error);
          });
          this.socket.on('close', () => {
            if (this.upgraded) return;
            if (!this.response?.complete && !this.destroyed)
              this.destroy(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
            else if (!this.destroyed) this.destroy();
          });
          if (options.timeout) this.setTimeout(options.timeout);
          this.emit('socket', this.socket);
          this.emit('assigned');
        } catch (error) {
          this.destroy(error as Error);
        }
      });
    }
    private onData = (chunk: Buffer) => {
      const consumed = this.parser.execute(chunk);
      if (consumed instanceof Error) {
        this.destroy(consumed);
        return;
      }
      if (this.upgraded) {
        this.socket.removeListener('data', this.onData);
        const event = this.method === 'CONNECT' ? 'connect' : 'upgrade';
        if (!this.emit(event, this.response, this.socket, chunk.subarray(consumed)))
          this.socket.destroy();
      }
    };
    setHeader(name: string, value: any) {
      if (this.headersSent) throw new Error('Cannot set headers after they are sent');
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        value === undefined ||
        /[\r\n\0]/.test(String(value))
      )
        throw new TypeError('Invalid HTTP header');
      this.headers.set(name.toLowerCase(), { name, value });
      return this;
    }
    getHeader(name: string) {
      return this.headers.get(name.toLowerCase())?.value;
    }
    getHeaders() {
      return Object.fromEntries([...this.headers].map(([name, { value }]) => [name, value]));
    }
    getHeaderNames() {
      return [...this.headers.keys()];
    }
    hasHeader(name: string) {
      return this.headers.has(name.toLowerCase());
    }
    removeHeader(name: string) {
      if (this.headersSent) throw new Error('Cannot remove headers after they are sent');
      this.headers.delete(name.toLowerCase());
    }
    private head() {
      if (this.headersSent) return Buffer.alloc(0);
      if (!this.hasHeader('connection')) this.setHeader('Connection', 'close');
      if (
        !this.hasHeader('content-length') &&
        !this.hasHeader('transfer-encoding') &&
        !['GET', 'HEAD'].includes(this.method)
      )
        this.setHeader('Transfer-Encoding', 'chunked');
      this.chunked = String(this.getHeader('transfer-encoding')).toLowerCase() === 'chunked';
      this.headersSent = true;
      let text = `${this.method} ${this.path} HTTP/1.1\r\n`;
      for (const { name, value } of this.headers.values())
        for (const item of Array.isArray(value) ? value : [value]) text += `${name}: ${item}\r\n`;
      return Buffer.from(text + '\r\n');
    }
    private send(bytes: Buffer, done: (error?: Error | null) => void) {
      if (bytes.length === 0) {
        done();
        return;
      }
      if (!this.socket) {
        this.once('assigned', () => this.send(bytes, done));
        return;
      }
      this.socket.write(bytes, done);
    }
    _write(chunk: any, encoding: BufferEncoding, done: (error?: Error | null) => void) {
      const data = Buffer.from(chunk, encoding);
      if (data.length === 0) {
        done();
        return;
      }
      const head = this.head();
      this.send(
        Buffer.concat([
          head,
          ...(this.chunked
            ? [Buffer.from(data.length.toString(16) + '\r\n'), data, Buffer.from('\r\n')]
            : [data]),
        ]),
        done,
      );
    }
    _final(done: (error?: Error | null) => void) {
      const head = this.head();
      this.send(
        Buffer.concat([head, this.chunked ? Buffer.from('0\r\n\r\n') : Buffer.alloc(0)]),
        done,
      );
    }
    flushHeaders() {
      this.send(this.head(), (error) => {
        if (error) this.destroy(error);
      });
    }
    setTimeout(timeout: number, callback?: () => void) {
      if (callback) this.once('timeout', callback);
      const apply = () => this.socket.setTimeout(timeout, () => this.emit('timeout'));
      if (this.socket) apply();
      else this.once('assigned', apply);
      return this;
    }
    abort() {
      this.aborted = true;
      this.emit('abort');
      this.destroy();
    }
    _destroy(error: Error | null, done: (error?: Error | null) => void) {
      this.socket?.destroy();
      done(error);
    }
  }
  function request(input: any, options?: any, callback?: any) {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }
    if (typeof input === 'string' || input instanceof URL) {
      const url = new URL(input);
      input = {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: url.pathname + url.search,
        ...(url.username
          ? { auth: `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` }
          : {}),
      };
    }
    return new ClientRequest({ ...input, ...options }, callback);
  }
  const get = (...args: any[]) => {
    const result = request(args[0], args[1], args[2]);
    result.end();
    return result;
  };
  return { ClientRequest, request, get };
}
