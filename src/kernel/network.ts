import net, { type Server, type Socket } from 'node:net';
import WebSocket from 'ws';

export type KernelEvent = (handle: number, event: string, ...args: any[]) => void;

/** Per-connection socket table. Only opaque handles and byte records cross the boundary. */
export class NetworkKernel {
  private sequence = 0;
  private sockets = new Map<number, Socket>();
  private servers = new Map<number, Server>();
  private websockets = new Map<number, WebSocket>();
  private requests = new Map<string, AbortController>();

  constructor(
    private event: KernelEvent,
    private allocate: () => number = () => ++this.sequence,
  ) {}

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

  private socketInfo(socket: Socket) {
    return {
      localAddress: socket.localAddress,
      localPort: socket.localPort,
      localFamily: socket.localFamily,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      remoteFamily: socket.remoteFamily,
    };
  }

  private attachSocket(socket: Socket, paused = false): number {
    const handle = this.next();
    this.sockets.set(handle, socket);
    if (paused) socket.pause();
    socket.on('connect', () => this.event(handle, 'connect', this.socketInfo(socket)));
    socket.on('ready', () => this.event(handle, 'ready'));
    socket.on('data', (data) =>
      this.event(
        handle,
        'data',
        typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data),
      ),
    );
    socket.on('end', () => this.event(handle, 'end'));
    socket.on('drain', () => this.event(handle, 'drain'));
    socket.on('timeout', () => this.event(handle, 'timeout'));
    socket.on('error', (error: NodeJS.ErrnoException & { address?: string; port?: number }) =>
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
    socket.on('close', (hadError) => {
      this.sockets.delete(handle);
      this.event(handle, 'close', hadError);
    });
    return handle;
  }

  adoptSocket(socket: Socket) {
    const handle = this.attachSocket(socket, true);
    return { handle, ...this.socketInfo(socket) };
  }

  async close(): Promise<void> {
    const servers = [...this.servers.values()];
    const sockets = [...this.sockets.values()];
    const websockets = [...this.websockets.values()];
    this.servers.clear();
    this.sockets.clear();
    this.websockets.clear();
    for (const socket of sockets) socket.destroy();
    for (const socket of websockets) socket.terminate();
    for (const request of this.requests.values()) request.abort();
    this.requests.clear();
    await Promise.allSettled(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
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
      case 'net.connect': {
        const socket = new net.Socket();
        const handle = this.attachSocket(socket);
        socket.connect(args[0]);
        return { handle };
      }
      case 'net.server': {
        const server = net.createServer(args[0] ?? {});
        const handle = this.next();
        this.servers.set(handle, server);
        server.on('connection', (socket) => {
          const socketHandle = this.attachSocket(socket, true);
          this.event(handle, 'connection', { handle: socketHandle, ...this.socketInfo(socket) });
        });
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
        this.socket(Number(args[0])).end(args[1]);
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
