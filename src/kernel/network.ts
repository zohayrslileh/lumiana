import net, { type Server, type Socket } from 'node:net';
import WebSocket from 'ws';
import tls from 'node:tls';
import { TlsContexts, tlsInfo } from './tls-contexts.js';
import type { NativeCallbacks } from './callbacks.js';

export type KernelEvent = (handle: number, event: string, ...args: any[]) => void;

/** Per-connection socket table. Only opaque handles and byte records cross the boundary. */
export class NetworkKernel {
  private sequence = 0;
  private connections = new Set<Socket>();
  private sockets = new Map<number, Socket>();
  private socketListeners = new Map<number, () => void>();
  private servers = new Map<number, Server>();
  private websockets = new Map<number, WebSocket>();
  readonly tls: TlsContexts;
  private handles = new WeakMap<Socket, number>();
  private requests = new Map<string, AbortController>();

  constructor(
    private event: KernelEvent,
    private allocate: () => number = () => ++this.sequence,
    private callbacks?: NativeCallbacks,
  ) {
    this.tls = new TlsContexts(
      () => this.next(),
      callbacks,
      (socket) => this.adoptSocket(socket),
    );
  }

  private next(): number {
    return this.allocate();
  }

  private socket(id: number): Socket {
    const socket = this.sockets.get(id);
    if (!socket) throw new ReferenceError(`Unknown socket handle ${id}`);
    return socket;
  }

  private server(id: number): Server {
    const server = this.servers.get(id);
    if (!server) throw new ReferenceError(`Unknown server handle ${id}`);
    return server;
  }

  private websocket(id: number): WebSocket {
    const socket = this.websockets.get(id);
    if (!socket) throw new ReferenceError(`Unknown WebSocket handle ${id}`);
    return socket;
  }

  socketInfo(socket: Socket) {
    return {
      localAddress: socket.localAddress,
      localPort: socket.localPort,
      localFamily: socket.localFamily,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      remoteFamily: socket.remoteFamily,
      ...(socket instanceof tls.TLSSocket ? tlsInfo(socket) : {}),
    };
  }

  private attachSocket(socket: Socket, paused = false): number {
    const existing = this.handles.get(socket);
    if (existing !== undefined && this.sockets.has(existing)) return existing;
    this.trackSocket(socket);
    const handle = this.next();
    this.sockets.set(handle, socket);
    this.handles.set(socket, handle);
    const listeners: [string, (...args: any[]) => void][] = [];
    const on = (event: string, listener: (...args: any[]) => void) => {
      listeners.push([event, listener]);
      socket.on(event, listener);
    };
    this.socketListeners.set(handle, () => {
      for (const [event, listener] of listeners) socket.off(event, listener);
      this.socketListeners.delete(handle);
    });
    if (paused) socket.pause();
    on('connect', () => this.event(handle, 'connect', this.socketInfo(socket)));
    on('ready', () => this.event(handle, 'ready'));
    if (socket instanceof tls.TLSSocket) {
      on('secure', () => this.event(handle, 'tlsState', this.socketInfo(socket)));
      on('secureConnect', () => {
        socket.pause();
        this.event(handle, 'secureConnect', this.socketInfo(socket));
      });
      on('session', (session) => this.event(handle, 'session', new Uint8Array(session)));
      on('OCSPResponse', (response) => this.event(handle, 'OCSPResponse', response));
    }
    on('data', (data) =>
      this.event(
        handle,
        'data',
        typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data),
      ),
    );
    on('end', () => this.event(handle, 'end'));
    on('drain', () => this.event(handle, 'drain'));
    on('timeout', () => this.event(handle, 'timeout'));
    on('error', (error: NodeJS.ErrnoException & { address?: string; port?: number }) =>
      this.event(handle, 'error', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        address: error.address,
        port: error.port,
      }),
    );
    on('close', (hadError) => {
      this.sockets.delete(handle);
      this.socketListeners.get(handle)?.();
      this.event(handle, 'close', hadError);
    });
    return handle;
  }

  trackSocket(socket: Socket): void {
    if (this.connections.has(socket)) return;
    this.connections.add(socket);
    socket.once('close', () => this.connections.delete(socket));
  }

  adoptSocket(socket: Socket) {
    const handle = this.attachSocket(socket, true);
    return { handle, ...this.socketInfo(socket) };
  }

  async close(): Promise<void> {
    const servers = [...this.servers.values()];
    const sockets = [...this.connections];
    this.connections.clear();
    const websockets = [...this.websockets.values()];
    this.servers.clear();
    this.sockets.clear();
    this.websockets.clear();
    for (const socket of sockets) socket.destroy();
    for (const socket of websockets) socket.terminate();
    for (const request of this.requests.values()) request.abort();
    this.requests.clear();
    this.tls.close();
    await Promise.allSettled(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  }

  private createServer(operation: string, args: any[]) {
    const secure = operation === 'tls.server';
    const server = secure
      ? tls.createServer(this.tls.options(args[0]))
      : net.createServer(args[0] ?? {});
    const handle = this.next();
    this.servers.set(handle, server);
    server.on('connection', (socket: Socket) => this.trackSocket(socket));
    server.on(secure ? 'secureConnection' : 'connection', (socket: Socket) => {
      const socketHandle = this.attachSocket(socket, true);
      this.event(handle, secure ? 'secureConnection' : 'connection', {
        handle: socketHandle,
        ...this.socketInfo(socket),
      });
    });
    if (secure)
      server.on('tlsClientError', (error: NodeJS.ErrnoException) =>
        this.event(handle, 'tlsClientError', {
          name: error.name,
          message: error.message,
          code: error.code,
        }),
      );
    server.on('listening', () => this.event(handle, 'listening', server.address()));
    server.on('error', (error: NodeJS.ErrnoException & { address?: string; port?: number }) =>
      this.event(handle, 'error', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        address: error.address,
        port: error.port,
      }),
    );
    server.on('close', () => {
      this.servers.delete(handle);
      this.event(handle, 'close');
    });
    return { handle };
  }

  executeSync(operation: string, args: any[]): any {
    if (operation === 'net.server' || operation === 'tls.server')
      return this.createServer(operation, args);
    if (operation === 'tls.serverMethod') {
      const server = this.server(args[0]) as tls.Server;
      const method = args[1],
        input = args.slice(2);
      if (method === 'addContext' && typeof input[1] === 'number')
        input[1] = this.tls.context(input[1]);
      const result = Reflect.apply((server as any)[method], server, input);
      return result === server ? undefined : result;
    }
    if (operation === 'tls.socket') {
      const socket = this.socket(Number(args[0])) as tls.TLSSocket;
      const method = args[1] as 'exportKeyingMaterial';
      const input = args.slice(2);
      if ((method as string) === 'renegotiate') {
        const id = input[1];
        input[1] = (error: Error | null) =>
          void this.callbacks?.async(id, [
            error ? { message: error.message, name: error.name } : null,
          ]);
      }
      return Reflect.apply(socket[method], socket, input);
    }
    return this.tls.executeSync(operation, args);
  }

  async execute(operation: string, args: any[]): Promise<any> {
    switch (operation) {
      case 'fetch.request': {
        const [token, url, input = {}] = args;
        const controller = new AbortController();
        this.requests.set(token, controller);
        try {
          const response = await fetch(url, { ...input, signal: controller.signal });
          return {
            body: new Uint8Array(await response.arrayBuffer()),
            headers: Object.fromEntries(response.headers),
            redirected: response.redirected,
            status: response.status,
            statusText: response.statusText,
            url: response.url,
          };
        } finally {
          this.requests.delete(token);
        }
      }
      case 'fetch.abort':
        this.requests.get(args[0])?.abort();
        return undefined;
      case 'websocket.open': {
        const socket = new WebSocket(args[0], args[1]);
        const handle = this.next();
        this.websockets.set(handle, socket);
        socket.on('open', () => this.event(handle, 'open'));
        socket.on('message', (data, binary) =>
          this.event(
            handle,
            'message',
            !binary
              ? data.toString()
              : new Uint8Array(Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[])),
            binary,
          ),
        );
        socket.on('error', (error) =>
          this.event(handle, 'error', { name: error.name, message: error.message }),
        );
        socket.on('close', (code, reason) => {
          this.websockets.delete(handle);
          this.event(handle, 'close', code, reason.toString());
        });
        return { handle };
      }
      case 'websocket.send':
        await new Promise<void>((resolve, reject) =>
          this.websocket(Number(args[0])).send(args[1], (error) =>
            error ? reject(error) : resolve(),
          ),
        );
        return undefined;
      case 'websocket.close':
        this.websockets.get(Number(args[0]))?.close(args[1], args[2]);
        return undefined;
      case 'tls.connect': {
        const { socket: socketHandle, ...options } = this.tls.options(args[0]);
        if (socketHandle !== undefined) {
          options.socket = this.socket(socketHandle);
          this.socketListeners.get(socketHandle)?.();
          this.sockets.delete(socketHandle);
        }
        // Hostname matching runs in the browser realm. OpenSSL still
        // validates the chain; application reads and writes wait for that check.
        options.checkServerIdentity = () => undefined;
        const socket = tls.connect(options);
        return { handle: this.attachSocket(socket) };
      }
      case 'net.connect': {
        const socket = new net.Socket();
        const handle = this.attachSocket(socket);
        socket.connect(args[0]);
        return { handle };
      }
      case 'tls.server':
      case 'net.server':
        return this.createServer(operation, args);
      case 'net.listen':
        this.server(Number(args[0])).listen(args[1]);
        return undefined;
      case 'net.server.close':
        this.server(Number(args[0])).close();
        return undefined;
      case 'net.server.unref':
        this.server(Number(args[0])).unref();
        return undefined;
      case 'net.server.ref':
        this.server(Number(args[0])).ref();
        return undefined;
      case 'net.write':
        await new Promise<void>((resolve, reject) =>
          this.socket(Number(args[0])).write(args[1], (error) =>
            error ? reject(error) : resolve(),
          ),
        );
        return undefined;
      case 'net.end':
        // Native end() without data remains a no-op after close. The peer can
        // close while the browser's writable finalizer is crossing the boundary.
        this.sockets.get(Number(args[0]))?.end(args[1]);
        return undefined;
      case 'net.destroy':
        this.sockets.get(Number(args[0]))?.destroy();
        return undefined;
      case 'net.pause':
        this.sockets.get(Number(args[0]))?.pause();
        return undefined;
      case 'net.resume':
        this.sockets.get(Number(args[0]))?.resume();
        return undefined;
      case 'net.ref':
        this.sockets.get(Number(args[0]))?.ref();
        return;
      case 'net.unref':
        this.sockets.get(Number(args[0]))?.unref();
        return;
      case 'net.setNoDelay':
        this.socket(Number(args[0])).setNoDelay(args[1]);
        return undefined;
      case 'net.setKeepAlive':
        this.socket(Number(args[0])).setKeepAlive(args[1], args[2]);
        return undefined;
      case 'net.setTimeout':
        this.socket(Number(args[0])).setTimeout(args[1]);
        return undefined;
      default:
        throw new TypeError(`Unknown network operation ${operation}`);
    }
  }
}
