import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import { constants as performanceConstants } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import type { Duplex } from 'node:stream';
import type { Http2SecureServer } from 'node:http2';
import { PREFIX, decodePacket, encodePacket, failure } from './protocol.js';
export interface HostOptions {
  root: string;
  username: string;
  password: string;
  mode?: 'development' | 'production';
  path?: string;
}
const equal = (actual: unknown, expected: string) => {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
interface Session {
  worker: Worker;
  signal: Int32Array;
  socket?: WebSocket;
  responses: Map<number, ServerResponse>;
  logs: Map<number, any[]>;
  stop(): Promise<void>;
  post(message: any): void;
}
/** Authentication creates a session; all subsequent traffic routes to its worker. */
export function attachHost(server: Server | Http2SecureServer, options: HostOptions) {
  const prefix = options.path ?? PREFIX;
  const sessions = new Map<string, Session>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 0 });
  let closing = false;
  const status = () => ({
    pid: process.pid,
    uptime: process.uptime(),
    serverTime: Date.now(),
    mode: options.mode ?? 'development',
    version: process.version,
    platform: process.platform,
    memory: process.memoryUsage(),
    connections: sessions.size,
  });
  const processSnapshot = () => ({
    env: { ...process.env },
    argv: [...process.argv],
    execArgv: [...process.execArgv],
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    versions: { ...process.versions },
    pid: process.pid,
    cwd: process.cwd(),
  });
  const osSnapshot = () => ({
    arch: os.arch(),
    availableParallelism: os.availableParallelism(),
    constants: os.constants,
    cpus: os.cpus(),
    devNull: os.devNull,
    endianness: os.endianness(),
    EOL: os.EOL,
    homedir: os.homedir(),
    hostname: os.hostname(),
    machine: os.machine(),
    networkInterfaces: os.networkInterfaces(),
    platform: os.platform(),
    release: os.release(),
    tmpdir: os.tmpdir(),
    totalmem: os.totalmem(),
    type: os.type(),
    uptime: os.uptime(),
    userInfo: os.userInfo(),
    version: os.version(),
  });
  function respond(res: ServerResponse, packet: any, sync = false): void {
    if (res.destroyed || res.writableEnded) return;
    const bytes = Buffer.from(encodePacket(packet));
    if (sync) {
      const text = Buffer.from(bytes.toString('base64'));
      const compressed = text.length > 1024;
      const body = compressed ? gzipSync(text) : text;
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=us-ascii',
        'Cache-Control': 'no-store',
        ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
        'Content-Length': body.length,
      });
      res.end(body);
    } else {
      res.writeHead(200, {
        'Content-Type': 'application/msgpack',
        'Cache-Control': 'no-store',
        'Content-Length': bytes.length,
      });
      res.end(bytes);
    }
  }
  async function establish(): Promise<{ id: string; session: Session }> {
    const id = randomUUID(),
      signal = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { root: options.root, signal: signal.buffer },
      stdout: true,
      stderr: true,
    });
    let stopped: Promise<void> | undefined;
    const startup = setTimeout(() => void session.stop(), 10_000);
    startup.unref();
    const session: Session = {
      worker,
      signal,
      responses: new Map(),
      logs: new Map(),
      post(message) {
        worker.postMessage(message);
        Atomics.add(signal, 0, 1);
        Atomics.notify(signal, 0);
      },
      stop() {
        return (stopped ??= (async () => {
          sessions.delete(id);
          clearTimeout(startup);
          for (const res of session.responses.values())
            respond(res, { ok: false, error: failure(new Error('Lumiana worker stopped')) }, true);
          session.responses.clear();
          session.logs.clear();
          session.socket?.close(1000, 'Lumiana disconnected');
          session.post({ type: 'close' });
          await worker.terminate();
        })());
      },
    };
    sessions.set(id, session);
    for (const [stream, level] of [
      [worker.stdout, 'log'],
      [worker.stderr, 'error'],
    ] as const) {
      stream?.on('data', (chunk: Buffer) => {
        if (session.socket?.readyState === WebSocket.OPEN)
          session.socket.send(encodePacket({ type: 'console', level, text: chunk.toString() }));
      });
    }
    worker.on('message', (message) => {
      if (message.type === 'ready') return;
      if (message.type === 'fatal') {
        session.socket?.send(encodePacket(message));
        void session.stop();
        return;
      }
      const context = message.type === 'result' ? message.id : message.context;
      if (
        message.type === 'console' &&
        message.context !== undefined &&
        session.responses.has(message.context)
      ) {
        const logs = session.logs.get(context) ?? [];
        logs.push(message);
        session.logs.set(context, logs);
        return;
      }
      const res =
        message.type === 'result' || message.type === 'callback'
          ? session.responses.get(context)
          : undefined;
      if (res) {
        session.responses.delete(context);
        respond(res, { ...message, logs: session.logs.get(context) ?? [] }, true);
        session.logs.delete(context);
      } else if (session.socket?.readyState === WebSocket.OPEN)
        session.socket.send(encodePacket(message));
    });
    worker.on('error', (error) => {
      session.socket?.send(encodePacket({ type: 'fatal', error: failure(error) }));
      void session.stop();
    });
    worker.on('exit', () => void session.stop());
    await new Promise<void>((resolve, reject) => {
      const ready = (m: any) => {
        if (m.type === 'ready') {
          worker.off('exit', exit);
          worker.off('message', ready);
          resolve();
        }
      };
      const exit = () => reject(new Error('Lumiana worker failed to start'));
      worker.on('message', ready);
      worker.once('exit', exit);
    });
    // Cleared when its one WebSocket attaches; abandoned initial requests expire.
    (session as any).attached = () => clearTimeout(startup);
    return { id, session };
  }
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void = () => {
      res.writeHead(404);
      res.end();
    },
  ): Promise<void> {
    const pathname = req.url?.split('?')[0];
    if (pathname !== prefix + 'connect' && pathname !== prefix + 'sync') {
      next();
      return;
    }
    if (req.method !== 'POST' || closing) {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const packet = decodePacket(Buffer.concat(chunks));
      if (pathname === prefix + 'connect') {
        if (
          !equal(packet.username, options.username) ||
          !equal(packet.password, options.password)
        ) {
          res.writeHead(401);
          res.end('Invalid credentials');
          return;
        }
        const { id, session } = await establish();
        if (res.destroyed) {
          void session.stop();
          return;
        }
        respond(res, {
          id,
          status: status(),
          process: processSnapshot(),
          os: osSnapshot(),
          performance: { constants: performanceConstants },
        });
      } else {
        const session = sessions.get(String(req.headers['x-lumiana-session']));
        if (!session || session.socket?.readyState !== WebSocket.OPEN) {
          res.writeHead(410);
          res.end('Lumiana is disconnected');
          return;
        }
        const context = packet.type === 'callback-result' ? packet.context : packet.id;
        session.responses.set(context, res);
        session.post(packet);
      }
    } catch (error) {
      respond(res, { ok: false, error: failure(error) }, pathname === prefix + 'sync');
    }
  }
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== prefix + 'ws') return;
    const session = sessions.get(url.searchParams.get('id') ?? '');
    if (!session || session.socket || closing) {
      socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      session.socket = ws;
      (session as any).attached();
      let alive = true;
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 30_000);
      heartbeat.unref();
      ws.on('pong', () => {
        alive = true;
      });
      ws.on('close', () => {
        clearInterval(heartbeat);
        void session.stop();
      });
      ws.on('error', () => {
        ws.terminate();
        void session.stop();
      });
      ws.on('message', (data, binary) => {
        try {
          if (!binary) throw new TypeError('Expected a binary message');
          const packet = decodePacket(
            new Uint8Array(
              Buffer.isBuffer(data)
                ? data
                : data instanceof ArrayBuffer
                  ? Buffer.from(data)
                  : Buffer.concat(data),
            ),
          );
          if (packet.type === 'status')
            ws.send(encodePacket({ type: 'status', id: packet.id, value: status() }));
          else session.post(packet);
        } catch (error) {
          ws.send(encodePacket({ type: 'fatal', error: failure(error) }));
          void session.stop();
        }
      });
      ws.send(encodePacket({ type: 'ready' }));
    });
  };
  server.on('upgrade', upgrade);
  const host = {
    handle,
    invalidate() {
      for (const session of sessions.values()) void session.stop();
    },
    async close() {
      closing = true;
      server.off('upgrade', upgrade);
      await Promise.all([...sessions.values()].map((s) => s.stop()));
      wss.close();
    },
  };
  server.once('close', () => void host.close());
  return host;
}
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
const within = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};

export function staticHandler(publicDir: string, base = '/') {
  const root = fs.realpath(publicDir);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]!);
      if (!pathname.startsWith(base)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const relative = pathname.slice(base.length);
      if (
        relative.includes('\0') ||
        relative.split(/[\\/]/).some((part) => part === '..' || part.startsWith('.'))
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const publicRoot = await root;
      let file = path.resolve(publicRoot, relative || 'index.html');
      if (!within(publicRoot, file)) {
        res.writeHead(403);
        res.end();
        return;
      }
      let stat;
      try {
        file = await fs.realpath(file);
        stat = await fs.stat(file);
      } catch {
        if (path.extname(relative)) {
          res.writeHead(404);
          res.end();
          return;
        }
        file = await fs.realpath(path.join(publicRoot, 'index.html'));
        stat = await fs.stat(file);
      }
      if (!within(publicRoot, file)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!stat.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  };
}

export interface ServeOptions extends HostOptions {
  publicDir: string;
  port?: number;
  hostname?: string;
  base?: string;
}
export async function serve(options: ServeOptions): Promise<Server> {
  const handler = staticHandler(options.publicDir, options.base);
  const server = http.createServer((req, res) => {
    void host.handle(req, res, () => {
      void handler(req, res);
    });
  });
  const host = attachHost(server, options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3883, options.hostname ?? '127.0.0.1', resolve);
  });
  const shutdown = () => {
    void host.close().then(() => server.close());
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.once('close', () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  });
  return server;
}
