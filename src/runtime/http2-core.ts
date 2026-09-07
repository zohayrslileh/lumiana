import stream from './stream.js';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { createHttp } from './http-core.js';
import {
  HeaderCodec,
  PREFACE,
  frame,
  defaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  h2error,
} from './http2-codec.js';

/** HTTP/2 runs on a local Duplex. Only the transport beneath that Duplex owns system handles. */
export function createHttp2(
  net: any,
  tls: any,
  http1 = createHttp(
    async () => {
      throw new Error('HTTP framing does not call the engine');
    },
    () => () => {},
    net,
  ),
): any {
  class Http2Stream extends stream.Duplex {
    session: Http2Session;
    id: number;
    pending = true;
    closed = false;
    rstCode = 0;
    sentHeaders: any;
    sentTrailers: any;
    headersSent = false;
    endAfterHeaders = false;
    pushAllowed: boolean;
    sendWindow: number;
    receiveWindow: number;
    remoteEnded = false;
    localEnded = false;
    credit = 0;
    initialHeaders = false;
    waitForTrailers = false;
    queue: { data: Buffer; offset: number; done: (error?: Error | null) => void }[] = [];
    private finalDone?: (error?: Error | null) => void;
    private timeout?: ReturnType<typeof setTimeout>;
    private timeoutMs = 0;
    constructor(session: Http2Session, id: number) {
      super({ autoDestroy: true, allowHalfOpen: true });
      this.session = session;
      this.id = id;
      this.sendWindow = session.remoteSettings.initialWindowSize;
      this.receiveWindow = session.localSettings.initialWindowSize;
      this.pushAllowed = Boolean(session.type === 0 && session.remoteSettings.enablePush);
    }
    get state() {
      return {
        localWindowSize: this.receiveWindow,
        state: this.closed ? 7 : this.localEnded ? 5 : this.remoteEnded ? 6 : 2,
        localClose: Number(this.localEnded),
        remoteClose: Number(this.remoteEnded),
        sumDependencyWeight: 0,
        weight: 16,
      };
    }
    get bufferSize() {
      return this.queue.reduce((size, entry) => size + entry.data.length - entry.offset, 0);
    }
    _read() {
      if (this.credit && !this.closed) {
        const credit = this.credit;
        this.credit = 0;
        this.receiveWindow += credit;
        this.session.windowUpdate(this.id, credit);
      }
    }
    _write(chunk: any, encoding: BufferEncoding, done: (error?: Error | null) => void) {
      if (this.session.type === 0 && !this.headersSent) this.respond();
      this.queue.push({ data: Buffer.from(chunk, encoding), offset: 0, done });
      this.session.flushStreams();
    }
    _final(done: (error?: Error | null) => void) {
      if (this.pending) {
        this.once('ready', () => this._final(done));
        return;
      }
      if (this.session.type === 0 && !this.headersSent) this.respond();
      if (this.localEnded) {
        done();
        return;
      }
      if (this.waitForTrailers) {
        this.finalDone = done;
        this.emit('wantTrailers');
        return;
      }
      this.localEnded = true;
      this.session.send(0, 1, this.id);
      done();
    }
    _destroy(error: Error | null, done: (error?: Error | null) => void) {
      if (!this.closed && !(this.localEnded && this.remoteEnded) && !this.session.destroyed)
        this.session.reset(this.id, this.rstCode || 8);
      this.closed = true;
      this.session.streams.delete(this.id);
      clearTimeout(this.timeout);
      for (const queued of this.queue.splice(0))
        queued.done(error ?? h2error('Stream closed', 'ERR_HTTP2_INVALID_STREAM'));
      this.finalDone?.(error);
      this.finalDone = undefined;
      this.session.flushStreams();
      this.session.maybeClose();
      done(error);
    }
    receive(data: Buffer, flowSize: number) {
      this.touch();
      this.receiveWindow -= flowSize;
      if (this.receiveWindow < 0) {
        this.session.fail('Stream flow-control window exceeded', 3);
        return;
      }
      this.credit += flowSize;
      if (this.push(data)) this._read();
    }
    finishRemote() {
      if (!this.remoteEnded) {
        this.remoteEnded = true;
        this.push(null);
        // Native ClientHttp2Stream reports `end` after the last delivered data
        // frame even when a data listener paused the stream. Reading zero bytes
        // advances the Readable EOF state without consuming buffered data or
        // changing the caller's paused/flowing state.
        this.read(0);
      }
    }
    respond(headers: any = {}, options: any = {}) {
      if (this.headersSent)
        throw h2error('Response headers already sent', 'ERR_HTTP2_HEADERS_SENT');
      this.sentHeaders = { ':status': 200, ...headers };
      this.headersSent = true;
      this.waitForTrailers = Boolean(options.waitForTrailers);
      this.session.sendHeaders(this.id, this.sentHeaders, options.endStream ? 1 : 0);
      if (options.endStream) {
        this.localEnded = true;
        this.endAfterHeaders = true;
        this.end();
      }
    }
    additionalHeaders(headers: any) {
      if (this.headersSent)
        throw h2error('Response headers already sent', 'ERR_HTTP2_HEADERS_SENT');
      this.session.sendHeaders(this.id, headers);
    }
    sendTrailers(headers: any) {
      if (!this.waitForTrailers || !this.finalDone)
        throw h2error('Trailers are not ready', 'ERR_HTTP2_TRAILERS_NOT_READY');
      this.sentTrailers = headers;
      this.localEnded = true;
      this.session.sendHeaders(this.id, headers, 1);
      const done = this.finalDone;
      this.finalDone = undefined;
      done();
    }
    pushStream(headers: any, options: any, callback?: any) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      if (!this.pushAllowed) {
        callback?.(h2error('Push is disabled', 'ERR_HTTP2_PUSH_DISABLED'));
        return;
      }
      try {
        const pushed = this.session.allocate();
        pushed.pending = false;
        pushed.remoteEnded = true;
        pushed.push(null);
        const promise = {
          ':method': 'GET',
          ':scheme': this.session.encrypted ? 'https' : 'http',
          ':authority': this.session.authority,
          ...headers,
        };
        this.session.sendHeaders(this.id, promise, 0, pushed.id);
        callback?.(null, pushed, promise);
      } catch (error) {
        callback?.(error);
      }
    }
    close(code = 0, callback?: () => void) {
      if (callback) this.once('close', callback);
      if (this.closed) return;
      this.rstCode = code;
      this.session.reset(this.id, code);
      this.closed = true;
      this.destroy(
        code && code !== 8
          ? h2error(`Stream closed with code ${code}`, 'ERR_HTTP2_STREAM_ERROR')
          : undefined,
      );
    }
    priority(options: any = {}) {
      const payload = Buffer.alloc(5);
      payload.writeUInt32BE((options.parent ?? 0) | (options.exclusive ? 0x80000000 : 0), 0);
      payload[4] = (options.weight ?? 16) - 1;
      if (!options.silent) this.session.send(2, 0, this.id, payload);
    }
    setTimeout(milliseconds: number, callback?: () => void) {
      if (callback) this.on('timeout', callback);
      this.timeoutMs = milliseconds;
      this.touch();
      return this;
    }
    private touch() {
      clearTimeout(this.timeout);
      if (this.timeoutMs) this.timeout = setTimeout(() => this.emit('timeout'), this.timeoutMs);
    }
  }

  class Http2Session extends EventEmitter {
    streams = new Map<number, Http2Stream>();
    localSettings: any = { ...defaultSettings };
    remoteSettings: any = { ...defaultSettings };
    connecting = true;
    closed = false;
    destroyed = false;
    encrypted: boolean;
    alpnProtocol: string | false;
    type: 0 | 1;
    authority: string;
    originSet: string[];
    socket: any;
    private codec = new HeaderCodec();
    private nextId: number;
    private requestQueue: { value: Http2Stream; headers: any; endStream: boolean }[] = [];
    private lastRemoteId = 0;
    private input = Buffer.alloc(0);
    private needPreface: boolean;
    private remoteSettingsReceived = false;
    private incomingHeaders?: { id: number; flags: number; promised?: number; chunks: Buffer[] };
    private sendWindow = 65535;
    private receiveWindow = 65535;
    private pending: (() => void)[] = [];
    private output: Buffer[] = [];
    private scheduled = false;
    private settingsQueue: { value: any; callback?: any; started: number }[] = [];
    private pings = new Map<string, { callback: any; started: number }[]>();
    private pingSequence = 0;
    private flushing = false;
    private closingSocket = false;
    constructor(socket: any, server: boolean, options: any = {}, authority = '') {
      super();
      this.socket = socket;
      this.type = server ? 0 : 1;
      this.nextId = server ? 2 : 1;
      this.needPreface = server;
      this.authority = authority;
      this.encrypted = Boolean(socket.encrypted);
      this.alpnProtocol = this.encrypted ? 'h2' : 'h2c';
      this.originSet = authority ? [(this.encrypted ? 'https://' : 'http://') + authority] : [];
      socket.on('data', (data: Buffer) => {
        try {
          this.parse(Buffer.from(data));
        } catch (error) {
          this.fail((error as Error).message);
        }
      });
      socket.on('error', (error: Error) => this.destroy(error));
      socket.on('end', () => this.destroy());
      socket.on('close', () => this.destroy());
      const start = () => {
        if (this.destroyed) return;
        if (this.encrypted && socket.alpnProtocol !== 'h2') {
          this.destroy(h2error('TLS peer did not negotiate h2', 'ERR_HTTP2_ERROR'));
          return;
        }
        this.connecting = false;
        if (!server) this.enqueue(PREFACE);
        this.settings(options.settings ?? {});
        this.emit('connect', this, socket);
        for (const action of this.pending.splice(0)) action();
        this.flushStreams();
      };
      if (server || (!socket.connecting && !socket.pending)) queueMicrotask(start);
      else socket.once(this.encrypted ? 'secureConnect' : 'connect', start);
    }
    get pendingSettingsAck() {
      return this.settingsQueue.length > 0;
    }
    get state() {
      return {
        effectiveLocalWindowSize: this.receiveWindow,
        localWindowSize: this.receiveWindow,
        remoteWindowSize: this.sendWindow,
        nextStreamID: this.nextId,
        lastProcStreamID: this.lastRemoteId,
        outboundQueueSize: this.output.length,
      };
    }
    private enqueue(bytes: Buffer) {
      if (this.destroyed) return;
      this.output.push(bytes);
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        const bytes = Buffer.concat(this.output.splice(0));
        if (bytes.length && !this.destroyed)
          this.socket.write(bytes, (error?: Error) => {
            if (error) this.destroy(error);
          });
        if (this.closingSocket && !this.destroyed) this.socket.end();
      });
    }
    send(type: number, flags: number, id: number, payload: Buffer = Buffer.alloc(0)) {
      this.enqueue(frame(type, flags, id, payload));
    }
    private ready(action: () => void) {
      if (this.connecting) this.pending.push(action);
      else action();
    }
    allocate(id = this.nextId) {
      if (id === this.nextId) this.nextId += 2;
      const value = new Http2Stream(this, id);
      this.streams.set(id, value);
      return value;
    }
    request(headers: any = {}, options: any = {}) {
      if (this.type !== 1 || this.closed || this.destroyed)
        throw h2error('Session cannot create a stream', 'ERR_HTTP2_GOAWAY_SESSION');
      const value = this.allocate();
      const method = headers[':method'] ?? 'GET';
      const normalized = {
        ':method': method,
        ':authority': this.authority,
        ...(method === 'CONNECT'
          ? {}
          : { ':scheme': this.encrypted ? 'https' : 'http', ':path': '/' }),
        ...headers,
      };
      value.sentHeaders = normalized;
      value.headersSent = true;
      value.waitForTrailers = Boolean(options.waitForTrailers);
      this.requestQueue.push({
        value,
        headers: normalized,
        endStream: options.endStream ?? ['GET', 'HEAD', 'DELETE'].includes(method),
      });
      this.ready(() => this.activateRequests());
      return value;
    }
    private activateRequests() {
      if (this.connecting || this.closed) return;
      let active = [...this.streams.values()].filter(
        (stream) =>
          !stream.pending && !(stream.localEnded && stream.remoteEnded) && stream.id % 2 === 1,
      ).length;
      while (this.requestQueue.length && active < this.remoteSettings.maxConcurrentStreams) {
        const { value, headers, endStream } = this.requestQueue.shift()!;
        if (value.destroyed) continue;
        value.pending = false;
        active++;
        this.sendHeaders(value.id, headers, endStream ? 1 : 0);
        if (endStream) {
          value.localEnded = true;
          value.endAfterHeaders = true;
        }
        value.emit('ready');
        if (endStream) value.end();
      }
    }
    sendHeaders(id: number, headers: any, flags = 0, promised?: number) {
      const bytes = this.codec.encode(headers),
        size = this.remoteSettings.maxFrameSize;
      let offset = 0,
        first = true;
      do {
        const prefix = first && promised !== undefined ? Buffer.alloc(4) : Buffer.alloc(0);
        if (prefix.length) prefix.writeUInt32BE(promised!, 0);
        const chunk = bytes.subarray(offset, offset + size - prefix.length);
        offset += chunk.length;
        this.send(
          first ? (promised === undefined ? 1 : 5) : 9,
          (first ? flags : 0) | (offset === bytes.length ? 4 : 0),
          id,
          Buffer.concat([prefix, chunk]),
        );
        first = false;
      } while (offset < bytes.length);
    }
    flushStreams() {
      if (this.flushing || this.connecting || this.destroyed) return;
      this.flushing = true;
      this.activateRequests();
      try {
        for (const value of this.streams.values()) {
          while (!value.pending && value.queue.length && !value.destroyed) {
            const queued = value.queue[0];
            const count = Math.min(
              queued.data.length - queued.offset,
              this.remoteSettings.maxFrameSize,
              this.sendWindow,
              value.sendWindow,
            );
            if (count <= 0 && queued.data.length !== queued.offset) break;
            if (count) {
              this.send(0, 0, value.id, queued.data.subarray(queued.offset, queued.offset + count));
              this.sendWindow -= count;
              value.sendWindow -= count;
              queued.offset += count;
            }
            if (queued.offset === queued.data.length) {
              value.queue.shift();
              queued.done();
            }
          }
        }
      } finally {
        this.flushing = false;
      }
    }
    windowUpdate(id: number, increment: number) {
      if (!increment) return;
      const bytes = Buffer.alloc(4);
      bytes.writeUInt32BE(increment, 0);
      this.send(8, 0, id, bytes);
    }
    reset(id: number, code: number) {
      const bytes = Buffer.alloc(4);
      bytes.writeUInt32BE(code, 0);
      this.send(3, 0, id, bytes);
    }
    settings(value: any, callback?: any) {
      const bytes = getPackedSettings(value);
      this.ready(() => {
        this.settingsQueue.push({ value, callback, started: performance.now() });
        this.send(4, 0, 0, bytes);
      });
    }
    ping(payload: any, callback?: any) {
      if (typeof payload === 'function') {
        callback = payload;
        payload = undefined;
      }
      const bytes = payload === undefined ? Buffer.alloc(8) : Buffer.from(payload);
      if (bytes.length !== 8) throw new RangeError('HTTP/2 ping payload must contain eight bytes');
      if (payload === undefined) bytes.writeUInt32BE(++this.pingSequence, 4);
      if (this.closed || this.destroyed) {
        queueMicrotask(() => callback?.(h2error('Ping cancelled', 'ERR_HTTP2_PING_CANCEL')));
        return false;
      }
      const id = bytes.toString('hex');
      const pending = { callback, started: performance.now() };
      const queue = this.pings.get(id) ?? [];
      queue.push(pending);
      this.pings.set(id, queue);
      this.ready(() => this.send(6, 0, 0, bytes));
      return true;
    }
    private parse(chunk: Buffer) {
      this.input = Buffer.concat([this.input, chunk]);
      if (this.needPreface) {
        if (this.input.length < PREFACE.length) return;
        if (!this.input.subarray(0, PREFACE.length).equals(PREFACE)) {
          this.fail('Invalid HTTP/2 connection preface');
          return;
        }
        this.input = this.input.subarray(PREFACE.length);
        this.needPreface = false;
      }
      while (this.input.length >= 9 && !this.destroyed) {
        const size = this.input.readUIntBE(0, 3),
          type = this.input[3],
          flags = this.input[4],
          id = this.input.readUInt32BE(5) & 0x7fffffff;
        if (size > this.localSettings.maxFrameSize) {
          this.fail('HTTP/2 frame exceeds negotiated size', 6);
          return;
        }
        if (this.input.length < size + 9) return;
        const payload = this.input.subarray(9, 9 + size);
        this.input = this.input.subarray(9 + size);
        if (!this.remoteSettingsReceived && (type !== 4 || flags & 1)) {
          this.fail('Expected initial SETTINGS frame');
          return;
        }
        if (this.incomingHeaders && (type !== 9 || id !== this.incomingHeaders.id)) {
          this.fail('Expected CONTINUATION frame');
          return;
        }
        this.handleFrame(type, flags, id, payload);
      }
    }
    private handleFrame(type: number, flags: number, id: number, payload: Buffer) {
      if (type === 4) {
        if (id || (flags & 1 ? payload.length !== 0 : payload.length % 6 !== 0)) {
          this.fail('Invalid SETTINGS frame', 6);
          return;
        }
        if (flags & 1) {
          const pending = this.settingsQueue.shift();
          if (!pending) {
            this.fail('Unexpected SETTINGS acknowledgement');
            return;
          }
          const delta =
            (pending.value.initialWindowSize ?? this.localSettings.initialWindowSize) -
            this.localSettings.initialWindowSize;
          Object.assign(this.localSettings, pending.value);
          if (pending.value.headerTableSize !== undefined)
            this.codec.setReceiveTableSize(pending.value.headerTableSize);
          for (const value of this.streams.values()) value.receiveWindow += delta;
          this.emit('localSettings', { ...this.localSettings });
          pending.callback?.(null, { ...this.localSettings }, performance.now() - pending.started);
          this.maybeClose();
        } else {
          const settings = getUnpackedSettings(payload, { validate: true });
          const delta =
            (settings.initialWindowSize ?? this.remoteSettings.initialWindowSize) -
            this.remoteSettings.initialWindowSize;
          Object.assign(this.remoteSettings, settings);
          this.remoteSettingsReceived = true;
          if (settings.headerTableSize !== undefined)
            this.codec.setSendTableSize(settings.headerTableSize);
          for (const value of this.streams.values()) {
            value.sendWindow += delta;
            value.pushAllowed = Boolean(this.type === 0 && this.remoteSettings.enablePush);
          }
          this.send(4, 1, 0);
          this.emit('remoteSettings', { ...this.remoteSettings });
          this.flushStreams();
        }
      } else if (type === 6) {
        if (id || payload.length !== 8) {
          this.fail('Invalid PING frame', 6);
          return;
        }
        if (flags & 1) {
          const key = payload.toString('hex');
          const queue = this.pings.get(key);
          const pending = queue?.shift();
          if (!queue?.length) this.pings.delete(key);
          pending?.callback?.(null, performance.now() - pending.started, payload);
        } else {
          this.send(6, 1, 0, payload);
          this.emit('ping', payload);
        }
      } else if (type === 8) {
        if (payload.length !== 4) {
          this.fail('Invalid WINDOW_UPDATE frame', 6);
          return;
        }
        const increment = payload.readUInt32BE(0) & 0x7fffffff;
        if (!increment) {
          this.fail('Zero window increment');
          return;
        }
        if (id) {
          const value = this.streams.get(id);
          if (value) {
            value.sendWindow += increment;
            if (value.sendWindow > 0x7fffffff) {
              this.fail('Stream window overflow', 3);
              return;
            }
          }
        } else {
          this.sendWindow += increment;
          if (this.sendWindow > 0x7fffffff) {
            this.fail('Connection window overflow', 3);
            return;
          }
        }
        this.flushStreams();
      } else if (type === 1 || type === 5 || type === 9) {
        if (!id) {
          this.fail('HEADERS require a stream');
          return;
        }
        if (type === 9) {
          if (!this.incomingHeaders) {
            this.fail('Unexpected CONTINUATION');
            return;
          }
          this.incomingHeaders.chunks.push(payload);
        } else {
          let start = 0,
            end = payload.length;
          if (flags & 8) {
            end -= payload[0];
            start++;
          }
          if (flags & 32) start += 5;
          let promised: number | undefined;
          if (type === 5) {
            if (this.type === 0 || !this.localSettings.enablePush) {
              this.fail('Unexpected PUSH_PROMISE');
              return;
            }
            promised = payload.readUInt32BE(start) & 0x7fffffff;
            start += 4;
          }
          if (start > end) {
            this.fail('Invalid header padding');
            return;
          }
          this.incomingHeaders = { id, flags, promised, chunks: [payload.subarray(start, end)] };
        }
        if (flags & 4) {
          const pending = this.incomingHeaders!;
          this.incomingHeaders = undefined;
          this.headers(
            pending.id,
            pending.flags,
            this.codec.decode(Buffer.concat(pending.chunks), this.localSettings.maxHeaderListSize),
            pending.promised,
          );
        }
      } else if (type === 0) {
        const value = this.streams.get(id);
        if (!id) {
          this.fail('DATA requires a stream');
          return;
        }
        if (!value || value.remoteEnded) {
          this.reset(id, 5);
          return;
        }
        let data = payload;
        if (flags & 8) {
          if (!payload.length || payload[0] >= payload.length) {
            this.fail('Invalid DATA padding');
            return;
          }
          data = payload.subarray(1, payload.length - payload[0]);
        }
        this.receiveWindow -= payload.length;
        if (this.receiveWindow < 0) {
          this.fail('Connection flow-control window exceeded', 3);
          return;
        }
        value.receive(data, payload.length);
        this.receiveWindow += payload.length;
        this.windowUpdate(0, payload.length);
        if (flags & 1) value.finishRemote();
      } else if (type === 3) {
        if (!id || payload.length !== 4) {
          this.fail('Invalid RST_STREAM', 6);
          return;
        }
        const value = this.streams.get(id);
        if (!value) return;
        value.rstCode = payload.readUInt32BE(0);
        value.closed = true;
        value.emit('aborted');
        value.destroy(
          value.rstCode && value.rstCode !== 8
            ? h2error(`Stream reset with code ${value.rstCode}`, 'ERR_HTTP2_STREAM_ERROR')
            : undefined,
        );
      } else if (type === 7) {
        if (id || payload.length < 8) {
          this.fail('Invalid GOAWAY', 6);
          return;
        }
        const last = payload.readUInt32BE(0) & 0x7fffffff,
          code = payload.readUInt32BE(4);
        this.closed = true;
        this.emit('goaway', code, last, payload.subarray(8));
        for (const value of this.streams.values())
          if (value.id % 2 === (this.type === 1 ? 1 : 0) && value.id > last) {
            value.closed = true;
            value.destroy(h2error('Stream refused after GOAWAY', 'ERR_HTTP2_STREAM_ERROR'));
          }
        if (code)
          this.destroy(h2error(`Session closed with code ${code}`, 'ERR_HTTP2_SESSION_ERROR'));
        else this.maybeClose();
      } else if (type === 2 && (!id || payload.length !== 5))
        this.fail('Invalid PRIORITY frame', 6);
    }
    private headers(
      id: number,
      flags: number,
      decoded: { headers: any; raw: string[] },
      promised?: number,
    ) {
      const { headers, raw } = decoded;
      if (promised !== undefined) {
        if (promised % 2 || this.streams.has(promised)) {
          this.fail('Invalid promised stream');
          return;
        }
        const pushed = this.allocate(promised);
        pushed.pending = false;
        pushed.localEnded = true;
        pushed.end();
        this.emit('stream', pushed, headers, flags, raw);
        return;
      }
      let value = this.streams.get(id);
      if (!value) {
        if (this.type !== 0 || id % 2 !== 1 || id <= this.lastRemoteId || this.closed) {
          this.fail('Invalid incoming stream');
          return;
        }
        this.lastRemoteId = id;
        value = this.allocate(id);
        value.pending = false;
        value.initialHeaders = true;
        this.authority ||= headers[':authority'] ?? '';
        this.emit('stream', value, headers, flags, raw);
      } else if (!value.initialHeaders) {
        if (!headers[':status']) {
          this.fail('Response lacks :status');
          return;
        }
        if (Number(headers[':status']) < 200) value.emit('headers', headers, flags, raw);
        else {
          value.initialHeaders = true;
          value.emit('response', headers, flags, raw);
        }
      } else {
        if (!(flags & 1)) {
          this.fail('Trailers must end the stream');
          return;
        }
        value.emit('trailers', headers, flags, raw);
      }
      if (flags & 1) value.finishRemote();
    }
    goaway(code = 0, lastStreamID = this.lastRemoteId, opaqueData?: Uint8Array) {
      const bytes = Buffer.alloc(8);
      bytes.writeUInt32BE(lastStreamID, 0);
      bytes.writeUInt32BE(code, 4);
      this.send(7, 0, 0, Buffer.concat([bytes, Buffer.from(opaqueData ?? [])]));
    }
    close(callback?: () => void) {
      if (callback) this.once('close', callback);
      this.closed = true;
      for (const { value } of this.requestQueue.splice(0)) {
        value.closed = true;
        value.destroy(h2error('Session closed before stream was sent', 'ERR_HTTP2_GOAWAY_SESSION'));
      }
      this.ready(() => {
        this.goaway();
        this.maybeClose();
      });
    }
    maybeClose() {
      if (
        this.closed &&
        !this.connecting &&
        !this.streams.size &&
        !this.settingsQueue.length &&
        !this.destroyed
      ) {
        this.closingSocket = true;
        if (!this.scheduled) this.socket.end();
      }
    }
    fail(message: string, code = 1) {
      this.goaway(code);
      queueMicrotask(() => this.destroy(h2error(message, 'ERR_HTTP2_SESSION_ERROR')));
    }
    destroy(error?: Error) {
      if (this.destroyed) return;
      this.destroyed = true;
      this.closed = true;
      for (const value of this.streams.values()) {
        value.closed = true;
        value.destroy(error);
      }
      this.streams.clear();
      this.socket.destroy();
      for (const queue of this.pings.values())
        for (const pending of queue)
          pending.callback?.(h2error('Ping cancelled', 'ERR_HTTP2_PING_CANCEL'));
      this.pending = [];
      this.requestQueue = [];
      this.pings.clear();
      for (const pending of this.settingsQueue.splice(0))
        pending.callback?.(error ?? h2error('Session closed'));
      if (error) this.emit('error', error);
      this.emit('close');
    }
    setTimeout(milliseconds: number, callback?: any) {
      if (callback) this.on('timeout', callback);
      this.socket.setTimeout(milliseconds, () => this.emit('timeout'));
      return this;
    }
    setLocalWindowSize(size: number) {
      const delta = size - this.receiveWindow;
      if (delta > 0) {
        this.receiveWindow = size;
        this.windowUpdate(0, delta);
      }
    }
    ref() {
      this.socket.ref();
      return this;
    }
    unref() {
      this.socket.unref();
      return this;
    }
  }

  class Http2ServerRequest extends stream.Readable {
    httpVersion = '2.0';
    httpVersionMajor = 2;
    httpVersionMinor = 0;
    headers: any;
    rawHeaders: string[];
    trailers: any = {};
    rawTrailers: string[] = [];
    method: string;
    url: string;
    authority: string;
    scheme: string;
    complete = false;
    aborted = false;
    socket: any;
    connection: any;
    constructor(
      readonly stream: Http2Stream,
      headers: any,
      raw: string[],
    ) {
      super({ autoDestroy: true });
      this.headers = headers;
      this.rawHeaders = raw;
      this.method = headers[':method'];
      this.url = headers[':path'];
      this.authority = headers[':authority'];
      this.scheme = headers[':scheme'];
      this.socket = this.connection = stream.session.socket;
      stream.on('data', (data: Buffer) => {
        if (!this.push(data)) stream.pause();
      });
      stream.on('end', () => {
        this.complete = true;
        this.push(null);
      });
      stream.on('trailers', (headers: any, _flags: number, raw: string[]) => {
        this.trailers = headers;
        this.rawTrailers = raw;
      });
      stream.on('aborted', () => {
        this.aborted = true;
        this.emit('aborted');
      });
      stream.on('error', (error: Error) => this.destroy(error));
    }
    _read() {
      this.stream.resume();
    }
    setTimeout(milliseconds: number, callback?: any) {
      this.stream.setTimeout(milliseconds, callback);
      return this;
    }
  }
  class Http2ServerResponse extends stream.Writable {
    statusCode = 200;
    sendDate = true;
    headersSent = false;
    private headers: any = {};
    private trailers?: any;
    socket: any;
    connection: any;
    constructor(readonly stream: Http2Stream) {
      super({ autoDestroy: true });
      this.socket = this.connection = stream.session.socket;
      stream.on('error', (error: Error) => this.destroy(error));
    }
    setHeader(name: string, value: any) {
      if (this.headersSent) throw h2error('Headers already sent', 'ERR_HTTP2_HEADERS_SENT');
      this.headers[name.toLowerCase()] = value;
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
      return this.getHeader(name) !== undefined;
    }
    removeHeader(name: string) {
      delete this.headers[name.toLowerCase()];
    }
    writeHead(status: number, statusMessage?: any, headers?: any) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(
        headers ?? (typeof statusMessage === 'object' ? statusMessage : {}),
      ))
        this.setHeader(name, value);
      this.flushHeaders();
      return this;
    }
    flushHeaders() {
      if (this.headersSent) return;
      this.headersSent = true;
      this.stream.respond(
        {
          ':status': this.statusCode,
          ...(this.sendDate ? { date: new Date().toUTCString() } : {}),
          ...this.headers,
        },
        { waitForTrailers: true },
      );
      this.stream.once('wantTrailers', () => this.stream.sendTrailers(this.trailers ?? {}));
    }
    addTrailers(headers: any) {
      this.trailers = headers;
    }
    _write(bytes: any, encoding: BufferEncoding, done: any) {
      this.flushHeaders();
      this.stream.write(bytes, encoding, done);
    }
    _final(done: any) {
      this.flushHeaders();
      this.stream.end(done);
    }
    setTimeout(milliseconds: number, callback?: any) {
      this.stream.setTimeout(milliseconds, callback);
      return this;
    }
  }
  class Http2Server extends EventEmitter {
    readonly connections = new Set<any>();
    options: any;
    closing = false;
    keepAliveTimeout = 5000;
    private transport: any;
    private sessions = new Set<Http2Session>();
    constructor(options: any = {}, listener?: any, secure = false) {
      super();
      if (typeof options === 'function') {
        listener = options;
        options = {};
      }
      this.options = options;
      if (listener) this.on('request', listener);
      this.transport = (secure ? tls : net).createServer(
        {
          ...options,
          ...(secure && !options.ALPNCallback
            ? { ALPNProtocols: options.allowHTTP1 ? ['h2', 'http/1.1'] : ['h2'] }
            : {}),
        },
        (socket: any) => {
          if (secure && socket.alpnProtocol !== 'h2') {
            if (options.allowHTTP1) http1.accept(this, socket);
            else if (!this.emit('unknownProtocol', socket)) socket.destroy();
            return;
          }
          const session = new Http2Session(socket, true, options);
          this.sessions.add(session);
          session.on('close', () => this.sessions.delete(session));
          session.on('error', (error) => this.emit('sessionError', error, session));
          session.on('stream', (value, headers, flags, raw) => {
            this.emit('stream', value, headers, flags, raw);
            if (this.listenerCount('request'))
              this.emit(
                'request',
                new Http2ServerRequest(value, headers, raw),
                new Http2ServerResponse(value),
              );
          });
          this.emit('session', session);
        },
      );
      for (const event of ['error', 'listening', 'close', 'tlsClientError'])
        this.transport.on(event, (...args: any[]) => this.emit(event, ...args));
    }
    get listening() {
      return this.transport.listening;
    }
    listen(...args: any[]) {
      this.transport.listen(...args);
      return this;
    }
    address() {
      return this.transport.address();
    }
    close(callback?: any) {
      this.closing = true;
      for (const connection of this.connections) if (connection.idle) connection.socket.destroy();
      this.transport.close(callback);
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
    ref() {
      this.transport.ref();
      return this;
    }
    unref() {
      this.transport.unref();
      return this;
    }
    updateSettings(settings: any) {
      for (const session of this.sessions) session.settings(settings);
    }
    setTimeout(milliseconds: number, callback?: any) {
      for (const session of this.sessions) session.setTimeout(milliseconds, callback);
      return this;
    }
  }
  class Http2SecureServer extends Http2Server {
    constructor(options?: any, listener?: any) {
      super(options, listener, true);
    }
  }
  function connect(authority: string | URL, options?: any, listener?: any) {
    if (typeof options === 'function') {
      listener = options;
      options = {};
    }
    options ??= {};
    const url = new URL(authority),
      encrypted = url.protocol === 'https:';
    if (!['http:', 'https:'].includes(url.protocol))
      throw h2error('Invalid HTTP/2 protocol', 'ERR_HTTP2_UNSUPPORTED_PROTOCOL');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const socket = options.createConnection
      ? options.createConnection(url, options)
      : (encrypted ? tls : net).connect({
          ...options,
          host: hostname,
          port: Number(url.port || (encrypted ? 443 : 80)),
          ...(encrypted
            ? {
                ALPNProtocols: ['h2'],
                servername: options.servername ?? (net.isIP?.(hostname) ? '' : hostname),
              }
            : {}),
        });
    const session = new Http2Session(socket, false, options, url.host);
    if (listener) session.once('connect', listener);
    return session;
  }
  return {
    connect,
    Http2Session,
    ClientHttp2Session: Http2Session,
    ServerHttp2Session: Http2Session,
    Http2Stream,
    ClientHttp2Stream: Http2Stream,
    ServerHttp2Stream: Http2Stream,
    Http2ServerRequest,
    Http2ServerResponse,
    Http2Server,
    Http2SecureServer,
    createServer: (options?: any, listener?: any) => new Http2Server(options, listener),
    createSecureServer: (options?: any, listener?: any) => new Http2SecureServer(options, listener),
  };
}
