import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { NetworkKernel, type KernelEvent } from './network.js';
import type { Socket } from 'node:net';

const errorRecord = (error: NodeJS.ErrnoException & { address?: string; port?: number }) => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
  code: error.code,
  errno: error.errno,
  syscall: error.syscall,
  address: error.address,
  port: error.port,
});

export class HttpKernel {
  private sequence = 0;
  private servers = new Map<number, Server>();
  private requests = new Map<number, IncomingMessage>();
  private responses = new Map<number, ServerResponse>();

  constructor(
    private event: KernelEvent,
    private allocate: () => number = () => ++this.sequence,
    private network = new NetworkKernel(event, allocate),
  ) {}

  private server(handle: number): Server {
    const server = this.servers.get(handle);
    if (!server) throw new ReferenceError(`Unknown HTTP server handle ${handle}`);
    return server;
  }

  private response(handle: number): ServerResponse {
    const response = this.responses.get(handle);
    if (!response) throw new ReferenceError(`Unknown HTTP response handle ${handle}`);
    return response;
  }

  private state(response: ServerResponse, state: any): void {
    if (response.headersSent || !state) return;
    response.statusCode = state.statusCode;
    if (state.statusMessage !== undefined) response.statusMessage = state.statusMessage;
    for (const [name, value] of Object.entries(state.headers ?? {}))
      response.setHeader(name, value as string | string[]);
  }

  private attach(serverHandle: number, request: IncomingMessage, response: ServerResponse): void {
    const requestHandle = this.allocate();
    const responseHandle = this.allocate();
    this.requests.set(requestHandle, request);
    this.responses.set(responseHandle, response);
    request.pause();
    request.on('data', (data) => this.event(requestHandle, 'data', new Uint8Array(data as Buffer)));
    request.on('end', () => {
      this.requests.delete(requestHandle);
      this.event(requestHandle, 'end');
    });
    request.on('aborted', () => this.event(requestHandle, 'aborted'));
    request.on('error', (error) => this.event(requestHandle, 'error', errorRecord(error)));
    request.on('close', () => this.event(requestHandle, 'close'));
    response.on('finish', () => this.event(responseHandle, 'finish'));
    response.on('close', () => {
      this.event(responseHandle, 'close');
    });
    response.on('error', (error) => this.event(responseHandle, 'error', errorRecord(error)));
    this.event(serverHandle, 'request', {
      request: requestHandle,
      response: responseHandle,
      method: request.method,
      url: request.url,
      headers: request.headers,
      headersDistinct: request.headersDistinct,
      rawHeaders: request.rawHeaders,
      trailers: request.trailers,
      rawTrailers: request.rawTrailers,
      httpVersion: request.httpVersion,
      httpVersionMajor: request.httpVersionMajor,
      httpVersionMinor: request.httpVersionMinor,
      complete: request.complete,
      socket: {
        localAddress: request.socket.localAddress,
        localPort: request.socket.localPort,
        localFamily: request.socket.localFamily,
        remoteAddress: request.socket.remoteAddress,
        remotePort: request.socket.remotePort,
        remoteFamily: request.socket.remoteFamily,
        encrypted: Boolean((request.socket as any).encrypted),
      },
    });
  }

  async close(): Promise<void> {
    await this.network.close();
    const servers = [...this.servers.values()];
    this.servers.clear();
    for (const response of this.responses.values()) response.destroy();
    for (const request of this.requests.values()) request.destroy();
    this.responses.clear();
    this.requests.clear();
    await Promise.allSettled(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  }

  async execute(operation: string, args: any[]): Promise<any> {
    switch (operation) {
      case 'http.server': {
        const handle = this.allocate();
        const server = http.createServer(args[0] ?? {}, (request, response) =>
          this.attach(handle, request, response),
        );
        this.servers.set(handle, server);
        for (const event of ['upgrade', 'connect'] as const)
          server.on(event, (request, socket, head) => {
            this.event(handle, event, {
              method: request.method,
              url: request.url,
              headers: request.headers,
              rawHeaders: request.rawHeaders,
              httpVersion: request.httpVersion,
              socket: this.network.adoptSocket(socket as Socket),
              head: new Uint8Array(head),
            });
          });
        server.on('listening', () => this.event(handle, 'listening', server.address()));
        server.on('close', () => {
          this.servers.delete(handle);
          this.event(handle, 'close');
        });
        server.on('error', (error) => this.event(handle, 'error', errorRecord(error)));
        return { handle };
      }
      case 'http.listen':
        this.server(Number(args[0])).listen(args[1]);
        return undefined;
      case 'http.server.close':
        this.server(Number(args[0])).close();
        return undefined;
      case 'http.server.closeAllConnections':
        this.server(Number(args[0])).closeAllConnections();
        return undefined;
      case 'http.server.closeIdleConnections':
        this.server(Number(args[0])).closeIdleConnections();
        return undefined;
      case 'http.server.ref':
        this.server(Number(args[0])).ref();
        return undefined;
      case 'http.server.unref':
        this.server(Number(args[0])).unref();
        return undefined;
      case 'http.request.resume':
        this.requests.get(Number(args[0]))?.resume();
        return undefined;
      case 'http.request.pause':
        this.requests.get(Number(args[0]))?.pause();
        return undefined;
      case 'http.request.destroy':
        this.requests.get(Number(args[0]))?.destroy();
        return undefined;
      case 'http.response.write': {
        const response = this.response(Number(args[0]));
        this.state(response, args[2]);
        if (response.write(args[1])) return true;
        return new Promise<boolean>((resolve, reject) => {
          const cleanup = () => {
            response.off('drain', drained);
            response.off('error', failed);
            response.off('close', closed);
          };
          const drained = () => {
            cleanup();
            resolve(false);
          };
          const failed = (error: Error) => {
            cleanup();
            reject(error);
          };
          const closed = () => {
            cleanup();
            reject(new Error('HTTP response closed before its write buffer drained'));
          };
          response.once('drain', drained);
          response.once('error', failed);
          response.once('close', closed);
        });
      }
      case 'http.response.end': {
        const handle = Number(args[0]);
        const response = this.response(handle);
        this.state(response, args[2]);
        if (!response.destroyed && !response.writableEnded)
          await new Promise<void>((resolve) => response.end(args[1], resolve));
        this.responses.delete(handle);
        return undefined;
      }
      case 'http.response.flush': {
        const response = this.response(Number(args[0]));
        this.state(response, args[1]);
        response.flushHeaders();
        return undefined;
      }
      case 'http.response.trailers':
        this.response(Number(args[0])).addTrailers(args[1]);
        return undefined;
      case 'http.response.destroy': {
        const handle = Number(args[0]);
        this.responses.get(handle)?.destroy();
        this.responses.delete(handle);
        return undefined;
      }
      default:
        throw new TypeError(`Unknown HTTP operation ${operation}`);
    }
  }
}
