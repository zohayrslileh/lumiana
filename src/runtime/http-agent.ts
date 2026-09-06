import { EventEmitter } from 'events';

type SocketFactory = (options: any, callback?: (error: Error | null, socket?: any) => void) => any;

/** Socket ownership and scheduling live in the JavaScript realm that owns requests. */
export function createAgent(createConnection: SocketFactory): any {
  class Agent extends EventEmitter {
    defaultPort = 80;
    protocol = 'http:';
    options: any;
    requests: Record<string, any[]> = Object.create(null);
    sockets: Record<string, any[]> = Object.create(null);
    freeSockets: Record<string, any[]> = Object.create(null);
    maxSockets: number;
    maxFreeSockets: number;
    maxTotalSockets: number;
    keepAlive: boolean;
    keepAliveMsecs: number;
    scheduling: 'fifo' | 'lifo';
    totalSocketCount = 0;
    private entries = new Map<
      any,
      { name: string; options: any; free: boolean; cleanup: () => void }
    >();
    private waiting = new Map<any, any>();
    private creating = new Map<string, number>();

    constructor(options: any = {}) {
      super();
      this.options = { ...options };
      this.keepAlive = options.keepAlive ?? false;
      this.keepAliveMsecs = options.keepAliveMsecs ?? 1000;
      this.maxSockets = options.maxSockets ?? Infinity;
      this.maxFreeSockets = options.maxFreeSockets ?? 256;
      this.maxTotalSockets = options.maxTotalSockets ?? Infinity;
      this.scheduling = options.scheduling ?? 'lifo';
      for (const name of ['maxSockets', 'maxTotalSockets'] as const)
        if (!(this[name] > 0)) throw new RangeError(`${name} must be greater than zero`);
      if (this.scheduling !== 'fifo' && this.scheduling !== 'lifo')
        throw new TypeError('Invalid Agent scheduling');
    }
    createConnection(options: any, callback?: any) {
      return createConnection(options, callback);
    }
    getName(options: any = {}) {
      return `${options.host ?? 'localhost'}:${options.port ?? this.defaultPort}:${options.localAddress ?? ''}:${options.family ?? ''}:${options.socketPath ?? options.path ?? ''}`;
    }
    addRequest(request: any, options: any) {
      options = { ...this.options, ...options };
      const name = this.getName(options);
      this.waiting.set(request, options);
      (this.requests[name] ??= []).push(request);
      const cancelled = () => {
        this.waiting.delete(request);
        this.remove(this.requests, name, request);
      };
      request.once('close', cancelled);
      this.schedule();
    }
    private schedule() {
      for (const name of Object.keys(this.requests)) {
        while (this.requests[name]?.length) {
          const request = this.requests[name][0];
          if (request.destroyed) {
            this.requests[name].shift();
            this.waiting.delete(request);
            continue;
          }
          const options = this.waiting.get(request);
          let socket: any;
          while (this.freeSockets[name]?.length) {
            socket =
              this.scheduling === 'fifo'
                ? this.freeSockets[name].shift()
                : this.freeSockets[name].pop();
            if (!socket.destroyed && socket.readable && socket.writable) break;
            socket = undefined;
          }
          if (!this.freeSockets[name]?.length) delete this.freeSockets[name];
          if (!socket && this.totalSocketCount >= this.maxTotalSockets) {
            const idle = Object.entries(this.freeSockets).find(
              ([key, values]) => key !== name && values.length,
            );
            if (idle) idle[1][0].destroy();
          }
          if (
            !socket &&
            ((this.sockets[name]?.length ?? 0) + (this.creating.get(name) ?? 0) >=
              this.maxSockets ||
              this.totalSocketCount >= this.maxTotalSockets)
          )
            break;
          this.requests[name].shift();
          if (!this.requests[name].length) delete this.requests[name];
          this.waiting.delete(request);
          if (socket) {
            this.entries.get(socket)!.free = false;
            (this.sockets[name] ??= []).push(socket);
            this.reuseSocket(socket, request);
            request.onSocket(socket);
          } else
            this.createSocket(request, options, (error: Error | null, created: any) =>
              request.onSocket(created, error),
            );
        }
      }
    }
    createSocket(
      request: any,
      options: any,
      callback: (error: Error | null, socket?: any) => void,
    ) {
      const name = this.getName(options);
      this.totalSocketCount++;
      this.creating.set(name, (this.creating.get(name) ?? 0) + 1);
      let settled = false;
      const ready = (error: Error | null, socket?: any) => {
        if (settled) return;
        settled = true;
        this.creating.set(name, this.creating.get(name)! - 1);
        if (error || !socket) {
          this.totalSocketCount--;
          callback(error ?? new Error('Agent did not create a socket'));
          this.schedule();
          return;
        }
        const closed = () => {
          this.removeSocket(socket, options);
          this.schedule();
        };
        const free = () => this.free(socket);
        const removed = () => {
          this.removeSocket(socket, options);
          this.schedule();
        };
        const timeout = () => {
          if (this.entries.get(socket)?.free) socket.destroy();
        };
        const data = () => {
          if (this.entries.get(socket)?.free) socket.destroy();
        };
        const failed = () => socket.destroy();
        socket.on('close', closed);
        socket.on('free', free);
        socket.on('agentRemove', removed);
        socket.on('timeout', timeout);
        socket.on('data', data);
        socket.on('error', failed);
        this.entries.set(socket, {
          name,
          options,
          free: false,
          cleanup: () => {
            socket.off('close', closed);
            socket.off('free', free);
            socket.off('agentRemove', removed);
            socket.off('timeout', timeout);
            socket.off('data', data);
            socket.off('error', failed);
          },
        });
        (this.sockets[name] ??= []).push(socket);
        if (request.destroyed) {
          socket.destroy();
          return;
        }
        callback(null, socket);
      };
      try {
        const socket = this.createConnection(options, ready);
        if (socket) ready(null, socket);
      } catch (error) {
        ready(error as Error);
      }
    }
    private free(socket: any) {
      const entry = this.entries.get(socket);
      if (!entry || entry.free) return;
      this.remove(this.sockets, entry.name, socket);
      const queued = this.requests[entry.name]?.some((request) => !request.destroyed);
      if (
        !socket.destroyed &&
        socket.writable &&
        socket.readable &&
        (queued ||
          (this.keepAlive &&
            (this.freeSockets[entry.name]?.length ?? 0) < this.maxFreeSockets &&
            this.keepSocketAlive(socket)))
      ) {
        entry.free = true;
        (this.freeSockets[entry.name] ??= []).push(socket);
        this.emit('free', socket, entry.options);
      } else socket.destroy();
      this.schedule();
    }
    keepSocketAlive(socket: any) {
      socket.setKeepAlive(true, this.keepAliveMsecs);
      socket.unref();
      socket.setTimeout(this.options.timeout ?? 0);
      return true;
    }
    reuseSocket(socket: any, request: any) {
      request.reusedSocket = true;
      socket.ref();
      socket.setTimeout(0);
    }
    removeSocket(socket: any, options: any) {
      const entry = this.entries.get(socket);
      if (!entry) return;
      entry.cleanup();
      this.entries.delete(socket);
      this.totalSocketCount--;
      this.remove(this.sockets, entry.name, socket);
      this.remove(this.freeSockets, entry.name, socket);
    }
    private remove(table: Record<string, any[]>, name: string, value: any) {
      const list = table[name];
      if (!list) return;
      const index = list.indexOf(value);
      if (index !== -1) list.splice(index, 1);
      if (!list.length) delete table[name];
    }
    destroy() {
      for (const request of this.waiting.keys()) request.destroy(new Error('Agent destroyed'));
      this.waiting.clear();
      this.requests = Object.create(null);
      for (const socket of this.entries.keys()) socket.destroy();
    }
  }
  return Agent;
}
