import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  IN_MEMORY_PATH_CODE,
  IN_MEMORY_EVENTS_CODE,
  IN_MEMORY_UTIL_CODE,
  IN_MEMORY_UTIL_TYPES_CODE,
  IN_MEMORY_BUFFER_CODE,
  IN_MEMORY_PROCESS_CODE,
  IN_MEMORY_ASSERT_CODE,
  IN_MEMORY_STRING_DECODER_CODE,
} from './in-memory-modules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3883;
const WS_PATH = '/lumiana-ws';

export interface LumianaPluginOptions {
  /**
   * Internal WebSocket authentication username (default: 'lumiana')
   */
  username?: string;
  /**
   * Internal WebSocket authentication password (default: 'lumiana')
   */
  password?: string;
}

function acceptKey(key: string): string {
  return crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function verifyAuth(req: IncomingMessage, expectedUser: string, expectedPass: string): boolean {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const u = url.searchParams.get('username') || url.searchParams.get('u');
    const p = url.searchParams.get('password') || url.searchParams.get('p');
    if (u === expectedUser && p === expectedPass) {
      return true;
    }

    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const [headerUser, headerPass] = decoded.split(':');
      if (headerUser === expectedUser && headerPass === expectedPass) {
        return true;
      }
    }

    const xAuth = req.headers['x-lumiana-auth'];
    if (xAuth) {
      const decoded = Buffer.from(String(xAuth), 'base64').toString('utf8');
      const [headerUser, headerPass] = decoded.split(':');
      if (headerUser === expectedUser && headerPass === expectedPass) {
        return true;
      }
    }
  } catch {}
  return false;
}

function encodeBinaryFrame(payload: Uint8Array): Buffer {
  const len = payload.length;
  if (len < 126) {
    const buf = Buffer.allocUnsafe(2 + len);
    buf[0] = 0x82; // FIN + Binary
    buf[1] = len;
    buf.set(payload, 2);
    return buf;
  } else if (len < 65536) {
    const buf = Buffer.allocUnsafe(4 + len);
    buf[0] = 0x82;
    buf[1] = 126;
    buf.writeUInt16BE(len, 2);
    buf.set(payload, 4);
    return buf;
  } else {
    const buf = Buffer.allocUnsafe(10 + len);
    buf[0] = 0x82;
    buf[1] = 127;
    buf.writeBigUInt64BE(BigInt(len), 2);
    buf.set(payload, 10);
    return buf;
  }
}

function decodeBinaryFrame(buffer: Buffer): { opcode: number; data: Uint8Array } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const isMasked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  const maskKey = isMasked ? buffer.subarray(offset, offset + 4) : null;
  if (isMasked) offset += 4;

  if (buffer.length < offset + payloadLen) return null;

  const rawData = buffer.subarray(offset, offset + payloadLen);
  const unmasked = new Uint8Array(payloadLen);

  if (maskKey) {
    for (let i = 0; i < payloadLen; i++) {
      unmasked[i] = rawData[i] ^ maskKey[i % 4];
    }
  } else {
    unmasked.set(rawData);
  }

  return { opcode, data: unmasked };
}

function serializeForClient(value: unknown, livingObjects: Map<string, unknown>): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return value;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { __lumiana_bin__: Array.from(value) };
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const isLiving =
    t === 'function' ||
    typeof (value as { on?: unknown })?.on === 'function' ||
    typeof (value as { pipe?: unknown })?.pipe === 'function' ||
    typeof (value as { kill?: unknown })?.kill === 'function' ||
    typeof (value as { close?: unknown })?.close === 'function';

  if (isLiving) {
    const refId = 'ref_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    livingObjects.set(refId, value);
    return { __lumiana_ref__: refId };
  }

  if (Array.isArray(value)) {
    return value.map((v) => serializeForClient(v, livingObjects));
  }

  if (t === 'object') {
    try {
      JSON.stringify(value);
      const proto = Object.getPrototypeOf(value);
      if (proto === null || proto === Object.prototype) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          obj[k] = serializeForClient(v, livingObjects);
        }
        return obj;
      }
    } catch {
      const refId = 'ref_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      livingObjects.set(refId, value);
      return { __lumiana_ref__: refId };
    }
  }

  return value;
}

function unmarshallArgs(args: unknown[], socket: Duplex | null, livingObjects: Map<string, unknown>): unknown[] {
  return args.map((arg) => {
    if (arg !== null && typeof arg === 'object') {
      if ((arg as { __lumiana_cb__?: string }).__lumiana_cb__) {
        const cbId = (arg as { __lumiana_cb__: string }).__lumiana_cb__;
        return (...cbArgs: unknown[]) => {
          if (!socket) return;
          const serializedCbArgs = cbArgs.map((a) => serializeForClient(a, livingObjects));
          const payload = JSON.stringify({ cbId, args: serializedCbArgs });
          const packet = Buffer.concat([Buffer.from([0x07]), Buffer.from(payload)]);
          socket.write(encodeBinaryFrame(packet));
        };
      }
      if ((arg as { __lumiana_bin__?: number[] }).__lumiana_bin__) {
        return Buffer.from((arg as { __lumiana_bin__: number[] }).__lumiana_bin__);
      }
      if ((arg as { __lumiana_ref__?: string }).__lumiana_ref__) {
        return livingObjects.get((arg as { __lumiana_ref__: string }).__lumiana_ref__);
      }
      if (Array.isArray(arg)) {
        return unmarshallArgs(arg, socket, livingObjects);
      }
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(arg as Record<string, unknown>)) {
        obj[k] = unmarshallArgs([v], socket, livingObjects)[0];
      }
      return obj;
    }
    return arg;
  });
}

async function resolveNodePath(
  refId: string | null,
  path: string[],
  args: unknown[] | null,
  isCall: boolean,
  livingObjects: Map<string, unknown>
): Promise<unknown> {
  let current: unknown;
  let parent: unknown = globalThis;
  let startIndex = 0;

  if (refId) {
    current = livingObjects.get(refId);
    if (current === undefined) {
      throw new Error(`Living object reference "${refId}" not found or expired`);
    }
    parent = current;
    startIndex = 0;
  } else {
    if (!path || path.length === 0) {
      throw new Error('Path cannot be empty');
    }
    const rootName = path[0];
    if (rootName === 'process') {
      current = process;
      parent = globalThis;
    } else if (rootName in globalThis) {
      current = (globalThis as Record<string, unknown>)[rootName];
      parent = globalThis;
    } else {
      const modName = rootName.startsWith('node:') ? rootName : 'node:' + rootName;
      try {
        current = await import(modName);
      } catch {
        current = await import(rootName);
      }
      parent = current;
    }
    startIndex = 1;
  }

  for (let i = startIndex; i < path.length; i++) {
    const seg = path[i];
    if (current == null) {
      throw new TypeError(`Cannot read property "${seg}" of ${current} at path "${path.slice(0, i).join('.')}"`);
    }

    if (typeof (current as { then?: unknown })?.then === 'function') {
      current = await current;
    }

    parent = current;
    const targetObj = current as Record<string, unknown>;

    current = targetObj[seg];
  }

  if (typeof (current as { then?: unknown })?.then === 'function') {
    current = await current;
  }

  if (isCall) {
    if (typeof current !== 'function') {
      throw new TypeError(`Path "${path.join('.')}" is not a function (type: ${typeof current})`);
    }
    return await Reflect.apply(current, parent, args || []);
  } else {
    if (typeof current === 'function') {
      return await Reflect.apply(current, parent, []);
    }
    return current;
  }
}

async function processBinaryMessage(
  data: Uint8Array,
  socket: Duplex,
  mode: 'development' | 'production',
  livingObjects: Map<string, unknown>
): Promise<void> {
  if (data.length === 0) return;
  const opcode = data[0];

  // Opcode 0x01 = PING
  if (opcode === 0x01 && data.length >= 9) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const clientTimestamp = view.getBigUint64(1);

    const pong = new Uint8Array(22);
    const pongView = new DataView(pong.buffer);
    pong[0] = 0x02; // PONG
    pongView.setBigUint64(1, clientTimestamp);
    pongView.setBigUint64(9, BigInt(Date.now()));
    pongView.setUint32(17, Math.floor(process.uptime()));
    pong[21] = mode === 'production' ? 0x01 : 0x00;

    socket.write(encodeBinaryFrame(pong));
    return;
  }

  // Opcode 0x03 = RUN_FUNCTION
  if (opcode === 0x03) {
    try {
      const text = new TextDecoder().decode(data.subarray(1));
      const req = JSON.parse(text);

      const fsMod = await import('node:fs');
      const ctx = {
        os: await import('node:os'),
        fs: fsMod.promises,
        path: await import('node:path'),
        process: process,
        import: (m: string) => import(m),
      };

      let fn: (...args: unknown[]) => unknown;
      try {
        fn = (0, eval)('(' + req.code + ')');
      } catch {
        const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
        fn = new AsyncFn('ctx', '...args', req.code);
      }

      const rawResult = await fn(ctx, ...(req.args || []));
      const result = serializeForClient(rawResult, livingObjects);
      const resPayload = JSON.stringify({ id: req.id, ok: true, result });
      const packet = Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)]);
      socket.write(encodeBinaryFrame(packet));
    } catch (err: unknown) {
      const text = new TextDecoder().decode(data.subarray(1));
      try {
        const req = JSON.parse(text);
        const errorMsg = err instanceof Error ? err.message : String(err);
        const resPayload = JSON.stringify({ id: req.id, ok: false, error: errorMsg });
        const packet = Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)]);
        socket.write(encodeBinaryFrame(packet));
      } catch {}
    }
    return;
  }

  // Opcode 0x05 = NODE_CALL
  if (opcode === 0x05) {
    try {
      const text = new TextDecoder().decode(data.subarray(1));
      const req = JSON.parse(text);

      const refId: string | null = req.refId || null;
      const pathSegments: string[] = Array.isArray(req.path)
        ? req.path
        : (req.module ? [req.module, req.method].filter(Boolean) : []);
      const isCall: boolean = req.isCall !== undefined ? Boolean(req.isCall) : true;
      const rawArgs: unknown[] | null = req.args ?? null;
      const callArgs: unknown[] | null = rawArgs !== null ? unmarshallArgs(rawArgs, socket, livingObjects) : null;

      const rawResult = await resolveNodePath(refId, pathSegments, callArgs, isCall, livingObjects);
      const result = serializeForClient(rawResult, livingObjects);

      const resPayload = JSON.stringify({ id: req.id, ok: true, result });
      const packet = Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)]);
      socket.write(encodeBinaryFrame(packet));
    } catch (err: unknown) {
      const text = new TextDecoder().decode(data.subarray(1));
      try {
        const req = JSON.parse(text);
        const errorMsg = err instanceof Error ? err.message : String(err);
        const resPayload = JSON.stringify({ id: req.id, ok: false, error: errorMsg });
        const packet = Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)]);
        socket.write(encodeBinaryFrame(packet));
      } catch {}
    }
    return;
  }
}

function handleWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  mode: 'development' | 'production',
  username: string,
  password: string
): void {
  if (!verifyAuth(req, username, password)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = acceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const livingObjects = new Map<string, unknown>();

  socket.on('data', async (chunk) => {
    const frame = decodeBinaryFrame(chunk);
    if (!frame) return;

    if (frame.opcode === 0x08) {
      socket.end();
      return;
    }

    if (frame.opcode === 0x02) {
      await processBinaryMessage(frame.data, socket, mode, livingObjects);
    }
  });

  socket.on('close', () => {
    livingObjects.clear();
  });

  socket.on('error', () => {
    socket.destroy();
  });
}

async function handleSyncHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  livingObjects: Map<string, unknown>,
  expectedUser?: string,
  expectedPass?: string
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-lumiana-auth');
    res.writeHead(204);
    res.end();
    return;
  }

  if (expectedUser && expectedPass && !verifyAuth(req, expectedUser, expectedPass)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(401);
    res.end(JSON.stringify({ ok: false, error: { message: 'Unauthorized: invalid credentials' } }));
    return;
  }

  let body = '';
  req.on('data', (chunk: any) => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const refId: string | null = parsed.refId || null;
      const pathSegments: string[] = Array.isArray(parsed.path)
        ? parsed.path
        : (parsed.module ? [parsed.module, parsed.method].filter(Boolean) : []);
      const isCall: boolean = parsed.isCall !== undefined ? Boolean(parsed.isCall) : true;
      const rawArgs: unknown[] | null = parsed.args ?? null;

      const callArgs = rawArgs !== null ? unmarshallArgs(rawArgs, null, livingObjects) : null;
      const rawResult = await resolveNodePath(refId, pathSegments, callArgs, isCall, livingObjects);
      const result = serializeForClient(rawResult, livingObjects);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, result }));
    } catch (err: any) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(
        JSON.stringify({
          ok: false,
          error: {
            message: err?.message || String(err),
            code: err?.code,
            stack: err?.stack,
          },
        })
      );
    }
  });
}

const NODE_BUILTIN_PREFIX = '\0lumiana-node:';
const NODE_BUILTIN_LIST = [
  'fs',
  'fs/promises',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'child_process',
  'process',
  'crypto',
  'buffer',
  'events',
  'util',
  'util/types',
  'stream',
  'stream/promises',
  'stream/web',
  'url',
  'assert',
  'http',
  'https',
  'net',
  'tls',
  'dns',
  'zlib',
  'readline',
  'perf_hooks',
  'timers',
  'timers/promises',
  'string_decoder',
  'constants',
];

export function lumiana(options: LumianaPluginOptions = {}): Plugin {
  const username = options.username ?? 'lumiana';
  const password = options.password ?? 'lumiana';

  let baseOutDir = 'dist';
  let isBuild = false;

  return {
    name: 'lumiana',
    enforce: 'pre',

    config(config, env) {
      isBuild = env.command === 'build';
      baseOutDir = path.resolve(config.root || process.cwd(), config.build?.outDir || 'dist');

      if (isBuild) {
        return {
          build: {
            outDir: path.join(baseOutDir, 'client'),
            emptyOutDir: true,
          },
        };
      }
    },

    resolveId(id) {
      if (id === 'virtual:lumiana' || id === 'lumiana' || id === 'lumiana/client') {
        return '\0virtual:lumiana';
      }
      const cleanId = id.startsWith('node:') ? id.slice(5) : id;
      if (NODE_BUILTIN_LIST.includes(cleanId)) {
        return `${NODE_BUILTIN_PREFIX}${cleanId}`;
      }
    },

    async load(id) {
      if (id === '\0virtual:lumiana') {
        const jsPath = path.resolve(__dirname, 'client.js');
        if (fs.existsSync(jsPath)) {
          return fs.readFileSync(jsPath, 'utf-8');
        }
        const tsPath = path.resolve(__dirname, 'client.ts');
        if (fs.existsSync(tsPath)) {
          return fs.readFileSync(tsPath, 'utf-8');
        }
      }

      if (id.startsWith(NODE_BUILTIN_PREFIX)) {
        const modName = id.slice(NODE_BUILTIN_PREFIX.length);

        // Instant in-memory modules (0ms browser execution, zero network requests)
        if (modName === 'path' || modName === 'path/posix' || modName === 'path/win32') {
          return IN_MEMORY_PATH_CODE;
        }
        if (modName === 'events') {
          return IN_MEMORY_EVENTS_CODE;
        }
        if (modName === 'util') {
          return IN_MEMORY_UTIL_CODE;
        }
        if (modName === 'util/types') {
          return IN_MEMORY_UTIL_TYPES_CODE;
        }
        if (modName === 'buffer') {
          return IN_MEMORY_BUFFER_CODE;
        }
        if (modName === 'process') {
          return IN_MEMORY_PROCESS_CODE;
        }
        if (modName === 'assert') {
          return IN_MEMORY_ASSERT_CODE;
        }
        if (modName === 'string_decoder') {
          return IN_MEMORY_STRING_DECODER_CODE;
        }

        try {
          const realMod = await import(modName.startsWith('node:') ? modName : `node:${modName}`);
          const keys = Object.keys(realMod).filter(
            (k) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) && k !== 'default'
          );
          const nonFuncs = keys.filter((k) => typeof (realMod as any)[k] !== 'function');

          const staticValues: Record<string, unknown> = {};
          for (const nf of nonFuncs) {
            try {
              const v = (realMod as any)[nf];
              if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                staticValues[nf] = v;
              } else if (v && typeof v === 'object' && !Array.isArray(v)) {
                staticValues[nf] = { ...v };
              }
            } catch {}
          }

          return `
import { createNodeModuleProxy } from 'virtual:lumiana';

const _modName = ${JSON.stringify(modName)};
const _staticValues = ${JSON.stringify(staticValues)};
const _mod = createNodeModuleProxy(_modName, [_modName], null, _staticValues);

export default _mod;
${keys.map((k) => `export const ${k} = _mod[${JSON.stringify(k)}];`).join('\n')}
`;
        } catch {
          return `
import { createNodeModuleProxy } from 'virtual:lumiana';
const _mod = createNodeModuleProxy(${JSON.stringify(modName)});
export default _mod;
`;
        }
      }
    },

    // 1. In Dev: Bind binary WebSocket and synchronous RPC to Vite dev server
    configureServer(server) {
      const devLivingObjects = new Map<string, unknown>();

      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/__lumiana_sync_node__')) {
          handleSyncHttpRequest(req, res as ServerResponse, devLivingObjects, username, password);
          return;
        }
        next();
      });

      server.httpServer?.on('upgrade', (req, socket) => {
        if (req.url?.startsWith(WS_PATH)) {
          handleWebSocketUpgrade(req, socket, 'development', username, password);
        }
      });
    },

    // 2. In Build: Inverted production build generating main.js with binary remote execution
    closeBundle() {
      if (!isBuild) return;

      const mainJsContent = `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, 'client');
const PORT = ${PORT};
const WS_PATH = '${WS_PATH}';
const USERNAME = ${JSON.stringify(username)};
const PASSWORD = ${JSON.stringify(password)};

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function acceptKey(key) {
  return crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function verifyAuth(req, expectedUser, expectedPass) {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const u = url.searchParams.get('username') || url.searchParams.get('u');
    const p = url.searchParams.get('password') || url.searchParams.get('p');
    if (u === expectedUser && p === expectedPass) return true;

    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const [headerUser, headerPass] = decoded.split(':');
      if (headerUser === expectedUser && headerPass === expectedPass) return true;
    }

    const xAuth = req.headers['x-lumiana-auth'];
    if (xAuth) {
      const decoded = Buffer.from(String(xAuth), 'base64').toString('utf8');
      const [headerUser, headerPass] = decoded.split(':');
      if (headerUser === expectedUser && headerPass === expectedPass) return true;
    }
  } catch {}
  return false;
}

function encodeBinaryFrame(payload) {
  const len = payload.length;
  if (len < 126) {
    const buf = Buffer.allocUnsafe(2 + len);
    buf[0] = 0x82;
    buf[1] = len;
    buf.set(payload, 2);
    return buf;
  } else if (len < 65536) {
    const buf = Buffer.allocUnsafe(4 + len);
    buf[0] = 0x82;
    buf[1] = 126;
    buf.writeUInt16BE(len, 2);
    buf.set(payload, 4);
    return buf;
  } else {
    const buf = Buffer.allocUnsafe(10 + len);
    buf[0] = 0x82;
    buf[1] = 127;
    buf.writeBigUInt64BE(BigInt(len), 2);
    buf.set(payload, 10);
    return buf;
  }
}

function decodeBinaryFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const isMasked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  const maskKey = isMasked ? buffer.subarray(offset, offset + 4) : null;
  if (isMasked) offset += 4;

  if (buffer.length < offset + payloadLen) return null;

  const rawData = buffer.subarray(offset, offset + payloadLen);
  const unmasked = new Uint8Array(payloadLen);

  if (maskKey) {
    for (let i = 0; i < payloadLen; i++) {
      unmasked[i] = rawData[i] ^ maskKey[i % 4];
    }
  } else {
    unmasked.set(rawData);
  }

  return { opcode, data: unmasked };
}

function serializeForClient(value, livingObjects) {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return value;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { __lumiana_bin__: Array.from(value) };
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const isLiving =
    t === 'function' ||
    typeof value?.on === 'function' ||
    typeof value?.pipe === 'function' ||
    typeof value?.kill === 'function' ||
    typeof value?.close === 'function';

  if (isLiving) {
    const refId = 'ref_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    livingObjects.set(refId, value);
    return { __lumiana_ref__: refId };
  }

  if (Array.isArray(value)) {
    return value.map((v) => serializeForClient(v, livingObjects));
  }

  if (t === 'object') {
    try {
      JSON.stringify(value);
      const proto = Object.getPrototypeOf(value);
      if (proto === null || proto === Object.prototype) {
        const obj = {};
        for (const [k, v] of Object.entries(value)) {
          obj[k] = serializeForClient(v, livingObjects);
        }
        return obj;
      }
    } catch {
      const refId = 'ref_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      livingObjects.set(refId, value);
      return { __lumiana_ref__: refId };
    }
  }

  return value;
}

function unmarshallArgs(args, socket, livingObjects) {
  return args.map((arg) => {
    if (arg !== null && typeof arg === 'object') {
      if (arg.__lumiana_cb__) {
        const cbId = arg.__lumiana_cb__;
        return (...cbArgs) => {
          if (!socket) return;
          const serializedCbArgs = cbArgs.map((a) => serializeForClient(a, livingObjects));
          const payload = JSON.stringify({ cbId, args: serializedCbArgs });
          socket.write(encodeBinaryFrame(Buffer.concat([Buffer.from([0x07]), Buffer.from(payload)])));
        };
      }
      if (arg.__lumiana_bin__) {
        return Buffer.from(arg.__lumiana_bin__);
      }
      if (arg.__lumiana_ref__) {
        return livingObjects.get(arg.__lumiana_ref__);
      }
      if (Array.isArray(arg)) {
        return unmarshallArgs(arg, socket, livingObjects);
      }
      const obj = {};
      for (const [k, v] of Object.entries(arg)) {
        obj[k] = unmarshallArgs([v], socket, livingObjects)[0];
      }
      return obj;
    }
    return arg;
  });
}

async function resolveNodePath(refId, path, args, isCall, livingObjects) {
  let current;
  let parent = globalThis;
  let startIndex = 0;

  if (refId) {
    current = livingObjects.get(refId);
    if (current === undefined) {
      throw new Error('Living object reference "' + refId + '" not found or expired');
    }
    parent = current;
    startIndex = 0;
  } else {
    if (!path || path.length === 0) {
      throw new Error('Path cannot be empty');
    }
    const rootName = path[0];
    if (rootName === 'process') {
      current = process;
      parent = globalThis;
    } else if (rootName in globalThis) {
      current = globalThis[rootName];
      parent = globalThis;
    } else {
      const modName = rootName.startsWith('node:') ? rootName : 'node:' + rootName;
      try {
        current = await import(modName);
      } catch {
        current = await import(rootName);
      }
      parent = current;
    }
    startIndex = 1;
  }

  for (let i = startIndex; i < path.length; i++) {
    const seg = path[i];
    if (current == null) {
      throw new TypeError('Cannot read property "' + seg + '" of ' + current + ' at path "' + path.slice(0, i).join('.') + '"');
    }

    if (typeof current?.then === 'function') {
      current = await current;
    }

    parent = current;
    const targetObj = current;

    current = targetObj[seg];
  }

  if (typeof current?.then === 'function') {
    current = await current;
  }

  if (isCall) {
    if (typeof current !== 'function') {
      throw new TypeError('Path "' + path.join('.') + '" is not a function (type: ' + typeof current + ')');
    }
    return await Reflect.apply(current, parent, args || []);
  } else {
    if (typeof current === 'function') {
      return await Reflect.apply(current, parent, []);
    }
    return current;
  }
}

async function processBinaryMessage(data, socket, livingObjects) {
  if (data.length === 0) return;
  const opcode = data[0];

  if (opcode === 0x01 && data.length >= 9) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const clientTimestamp = view.getBigUint64(1);

    const pong = new Uint8Array(22);
    const pongView = new DataView(pong.buffer);
    pong[0] = 0x02;
    pongView.setBigUint64(1, clientTimestamp);
    pongView.setBigUint64(9, BigInt(Date.now()));
    pongView.setUint32(17, Math.floor(process.uptime()));
    pong[21] = 0x01; // prod mode

    socket.write(encodeBinaryFrame(pong));
    return;
  }

  if (opcode === 0x03) {
    try {
      const text = new TextDecoder().decode(data.subarray(1));
      const req = JSON.parse(text);
      const fsMod = await import('node:fs');
      const ctx = {
        os: await import('node:os'),
        fs: fsMod.promises,
        path: await import('node:path'),
        process: process,
        import: (m) => import(m),
      };

      let fn;
      try {
        fn = (0, eval)('(' + req.code + ')');
      } catch {
        const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
        fn = new AsyncFn('ctx', '...args', req.code);
      }
      const rawResult = await fn(ctx, ...(req.args || []));
      const result = serializeForClient(rawResult, livingObjects);
      const resPayload = JSON.stringify({ id: req.id, ok: true, result });
      socket.write(encodeBinaryFrame(Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)])));
    } catch (err) {
      const text = new TextDecoder().decode(data.subarray(1));
      try {
        const req = JSON.parse(text);
        const resPayload = JSON.stringify({ id: req.id, ok: false, error: err?.message || String(err) });
        socket.write(encodeBinaryFrame(Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)])));
      } catch {}
    }
    return;
  }

  if (opcode === 0x05) {
    try {
      const text = new TextDecoder().decode(data.subarray(1));
      const req = JSON.parse(text);

      const refId = req.refId || null;
      const pathSegments = Array.isArray(req.path)
        ? req.path
        : (req.module ? [req.module, req.method].filter(Boolean) : []);
      const isCall = req.isCall !== undefined ? Boolean(req.isCall) : true;
      const rawArgs = req.args ?? null;
      const callArgs = rawArgs !== null ? unmarshallArgs(rawArgs, socket, livingObjects) : null;

      const rawResult = await resolveNodePath(refId, pathSegments, callArgs, isCall, livingObjects);
      const result = serializeForClient(rawResult, livingObjects);
      const resPayload = JSON.stringify({ id: req.id, ok: true, result });
      socket.write(encodeBinaryFrame(Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)])));
    } catch (err) {
      const text = new TextDecoder().decode(data.subarray(1));
      try {
        const req = JSON.parse(text);
        const resPayload = JSON.stringify({ id: req.id, ok: false, error: err?.message || String(err) });
        socket.write(encodeBinaryFrame(Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)])));
      } catch {}
    }
    return;
  }
}

const livingObjects = new Map();

async function handleSyncHttpRequest(req, res, livingObjects, expectedUser, expectedPass) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-lumiana-auth');
    res.writeHead(204);
    res.end();
    return;
  }

  if (expectedUser && expectedPass && !verifyAuth(req, expectedUser, expectedPass)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(401);
    res.end(JSON.stringify({ ok: false, error: { message: 'Unauthorized: invalid credentials' } }));
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const refId = parsed.refId || null;
      const pathSegments = Array.isArray(parsed.path)
        ? parsed.path
        : (parsed.module ? [parsed.module, parsed.method].filter(Boolean) : []);
      const isCall = parsed.isCall !== undefined ? Boolean(parsed.isCall) : true;
      const rawArgs = parsed.args ?? null;

      const callArgs = rawArgs !== null ? unmarshallArgs(rawArgs, null, livingObjects) : null;
      const rawResult = await resolveNodePath(refId, pathSegments, callArgs, isCall, livingObjects);
      const result = serializeForClient(rawResult, livingObjects);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: false,
        error: {
          message: err?.message || String(err),
          code: err?.code,
          stack: err?.stack,
        }
      }));
    }
  });
}

const server = http.createServer((req, res) => {
  const cleanUrl = (req.url || '/').split('?')[0];

  if (cleanUrl === '/__lumiana_sync_node__' && req.method === 'POST') {
    handleSyncHttpRequest(req, res, livingObjects, USERNAME, PASSWORD);
    return;
  }

  let filePath = path.join(clientDir, cleanUrl === '/' ? 'index.html' : cleanUrl);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(clientDir, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.on('upgrade', (req, socket) => {
  if (!req.url?.startsWith(WS_PATH)) {
    socket.destroy();
    return;
  }

  if (!verifyAuth(req, USERNAME, PASSWORD)) {
    socket.write('HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = acceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\\r\\n' +
    'Upgrade: websocket\\r\\n' +
    'Connection: Upgrade\\r\\n' +
    \`Sec-WebSocket-Accept: \${accept}\\r\\n\\r\\n\`
  );

  socket.on('data', async (chunk) => {
    const frame = decodeBinaryFrame(chunk);
    if (!frame) return;

    if (frame.opcode === 0x08) {
      socket.end();
      return;
    }

    if (frame.opcode === 0x02) {
      await processBinaryMessage(frame.data, socket, livingObjects);
    }
  });

  socket.on('close', () => {
    // Keep livingObjects across reconnects or clear if needed
  });

  socket.on('error', () => {
    socket.destroy();
  });
});

server.listen(PORT, () => {
  console.log('⚡ Lumiana Authenticated Binary WebSocket Server running at ws://localhost:' + PORT + WS_PATH);
});
`;

      fs.mkdirSync(baseOutDir, { recursive: true });
      fs.writeFileSync(path.join(baseOutDir, 'main.js'), mainJsContent, 'utf-8');
      console.log('⚡ [Lumiana] Built standalone authenticated binary websocket server: dist/main.js');
    },
  };
}

export default lumiana;
