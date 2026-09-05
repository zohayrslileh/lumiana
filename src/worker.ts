// @ts-nocheck
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { lumianaEncode, lumianaDecode } from './codec.js';

if (!parentPort) {
  throw new Error('[Lumiana Worker] This file must be executed inside a worker thread.');
}

const projectRoot: string = workerData?.projectRoot || process.cwd();
const mode: string = workerData?.mode || 'development';
const livingObjects = new Map<string, any>();
const livingReverseMap = new WeakMap<object, string>();
const pendingCallbacks = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

const origConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

function sendLogToClient(level: string, args: any[]) {
  try {
    const marshalled = args.map((a) => {
      try {
        return serializeForClient(a, livingObjects);
      } catch {
        return String(a);
      }
    });
    const payload = lumianaEncode({ level, args: marshalled });
    const packet = Buffer.concat([Buffer.from([0x0B]), Buffer.from(payload)]);
    parentPort?.postMessage({ type: 'WS_SEND', data: packet });
  } catch {}
}

console.log = (...args: any[]) => {
  origConsole.log(...args);
  sendLogToClient('log', args);
};
console.info = (...args: any[]) => {
  origConsole.info(...args);
  sendLogToClient('info', args);
};
console.warn = (...args: any[]) => {
  origConsole.warn(...args);
  sendLogToClient('warn', args);
};
console.error = (...args: any[]) => {
  origConsole.error(...args);
  sendLogToClient('error', args);
};
console.debug = (...args: any[]) => {
  origConsole.debug(...args);
  sendLogToClient('debug', args);
};

function sendFatalErrorToClient(err: any) {
  try {
    const errorInfo = {
      message: err?.message || String(err),
      stack: err?.stack || '',
      code: err?.code,
      errno: err?.errno,
      syscall: err?.syscall,
      path: err?.path,
      spawnargs: err?.spawnargs,
    };
    const payload = lumianaEncode(errorInfo);
    const packet = Buffer.concat([Buffer.from([0x0C]), Buffer.from(payload)]);
    parentPort?.postMessage({ type: 'WS_SEND', data: packet });
  } catch {}
}

process.on('uncaughtException', (err) => {
  origConsole.error('[Lumiana Worker Uncaught Exception]', err);
  sendFatalErrorToClient(err);
});

process.on('unhandledRejection', (reason) => {
  origConsole.error('[Lumiana Worker Unhandled Rejection]', reason);
  sendFatalErrorToClient(reason);
});

function serializeForClient(value: any, livingObjects: Map<string, any>, seen = new Set<any>()): any {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, code: (value as any).code };
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  const proto = value !== null && t === 'object' ? Object.getPrototypeOf(value) : null;
  const isCustomClassInstance = proto !== null && proto !== Object.prototype && proto !== Array.prototype;
  const isLiving =
    t === 'function' ||
    typeof value?.on === 'function' ||
    typeof value?.pipe === 'function' ||
    typeof value?.kill === 'function' ||
    typeof value?.close === 'function' ||
    typeof value?.listen === 'function' ||
    typeof value?.fetch === 'function' ||
    isCustomClassInstance;

  if (isLiving) {
    seen.add(value);
    let refId: string | undefined;
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
      refId = livingReverseMap.get(value);
    }
    if (!refId) {
      refId = 'ref_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      livingObjects.set(refId, value);
      if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
        try {
          livingReverseMap.set(value, refId);
        } catch {}
      }
    }
    const props: Record<string, any> = {};
    if (typeof value === 'object' && value !== null) {
      for (const key of [
        'method',
        'url',
        'statusCode',
        'statusMessage',
        'headers',
        'rawHeaders',
        'httpVersion',
        'params',
        'query',
        'body',
        'ip',
        'path',
        'originalUrl',
        'baseUrl',
        'hostname',
      ]) {
        if (key in value) {
          try {
            props[key] = serializeForClient(value[key], livingObjects, seen);
          } catch {}
        }
      }
    }
    return { __lumiana_ref__: refId, __props__: props };
  }
  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((v) => serializeForClient(v, livingObjects, seen));
  }
  if (t === 'object' && (proto === null || proto === Object.prototype)) {
    seen.add(value);
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = serializeForClient(v, livingObjects, seen);
    }
    return obj;
  }
  return String(value);
}

async function serializeForClientAsync(value: any, livingObjects: Map<string, any>): Promise<any> {
  if (
    value &&
    typeof value === 'object' &&
    typeof value.arrayBuffer === 'function' &&
    typeof value.status === 'number'
  ) {
    try {
      const headers: Record<string, string> = {};
      if (value.headers && typeof value.headers.forEach === 'function') {
        value.headers.forEach((v: string, k: string) => {
          headers[k] = v;
        });
      }
      let body: number[] | null = null;
      if (![101, 204, 205, 304].includes(value.status)) {
        try {
          const ab = await value.arrayBuffer();
          body = Array.from(new Uint8Array(ab));
        } catch {}
      }
      return {
        __lumiana_response__: true,
        status: value.status,
        statusText: value.statusText || '',
        headers,
        body,
      };
    } catch {}
  }
  return serializeForClient(value, livingObjects);
}

function unmarshallArgs(args: any[], livingObjects: Map<string, any>): any[] {
  return args.map((arg) => {
    if (arg === null || arg === undefined) return arg;
    if (arg instanceof Uint8Array || Buffer.isBuffer(arg)) {
      return Buffer.from(arg.buffer, arg.byteOffset, arg.byteLength);
    }
    if (typeof arg === 'object') {
      if (arg.__lumiana_cb__) {
        const cbId = arg.__lumiana_cb__;
        return async (...cbArgs: any[]) => {
          try {
            const callId = 'call_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
            const serializedCbArgs = await Promise.all(
              cbArgs.map((a) => serializeForClientAsync(a, livingObjects))
            );
            const payload = lumianaEncode({ callId, cbId, args: serializedCbArgs });
            const packet = Buffer.concat([Buffer.from([0x07]), Buffer.from(payload)]);

            const resPromise = new Promise((resolve, reject) => {
              pendingCallbacks.set(callId, { resolve, reject });
              setTimeout(() => {
                if (pendingCallbacks.has(callId)) {
                  pendingCallbacks.delete(callId);
                  resolve(undefined);
                }
              }, 30000);
            });

            parentPort.postMessage({ type: 'WS_SEND', data: packet });
            return await resPromise;
          } catch (err) {
            console.error('[Lumiana Worker] Error sending callback frame:', err);
          }
        };
      }
      if (arg.__lumiana_bin64__) {
        return Buffer.from(arg.__lumiana_bin64__, 'base64');
      }
      if (arg.__lumiana_bin__) {
        if (typeof arg.__lumiana_bin__ === 'string') {
          return Buffer.from(arg.__lumiana_bin__, 'base64');
        }
        return Buffer.from(arg.__lumiana_bin__);
      }
      if (arg.__lumiana_ref__) {
        return livingObjects.get(arg.__lumiana_ref__);
      }
      if (Array.isArray(arg)) {
        return unmarshallArgs(arg, livingObjects);
      }
      const obj: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg)) {
        obj[k] = unmarshallArgs([v], livingObjects)[0];
      }
      return obj;
    }
    return arg;
  });
}

const NODE_BUILTIN_LIST = [
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  'sqlite',
  'test'
];

async function importProjectModule(modName: string, rootDir: string): Promise<any> {
  const cleanId = modName.startsWith('node:') ? modName.slice(5) : modName;
  if (NODE_BUILTIN_LIST.includes(cleanId) || modName.startsWith('node:')) {
    return modName.startsWith('node:') ? import(modName) : import(`node:${cleanId}`);
  }
  try {
    const req = createRequire(path.join(rootDir, 'package.json'));
    const resolved = req.resolve(modName);
    try {
      return await import(pathToFileURL(resolved).href);
    } catch {
      return req(resolved);
    }
  } catch {
    try {
      const req = createRequire(path.join(process.cwd(), 'dummy.js'));
      const resolved = req.resolve(modName);
      try {
        return await import(pathToFileURL(resolved).href);
      } catch {
        return req(resolved);
      }
    } catch {
      return await import(modName);
    }
  }
}

async function resolveNodePath(
  refId: string | null,
  pathSegments: string[],
  args: any[] | null,
  isCall: boolean,
  livingObjects: Map<string, any>,
  rootDir: string = projectRoot,
  isConstructor: boolean = false,
  isSet: boolean = false
): Promise<any> {
  let current: any;
  let parent: any = globalThis;
  let startIndex = 0;

  if (refId) {
    current = livingObjects.get(refId);
    if (current === undefined) {
      throw new Error('Living object reference "' + refId + '" not found or expired');
    }
    parent = current;
    startIndex = 0;
  } else {
    if (!pathSegments || pathSegments.length === 0) {
      throw new Error('Path cannot be empty');
    }
    const rootName = pathSegments[0];
    const cleanRoot = rootName.startsWith('node:') ? rootName.slice(5) : rootName;

    if (rootName === 'process') {
      if (pathSegments.length === 2 && pathSegments[1] === '__lumiana_info__') {
        return {
          pid: process.pid,
          ppid: process.ppid,
          version: process.version,
          versions: process.versions,
          platform: process.platform,
          arch: process.arch,
          title: process.title,
          execPath: process.execPath,
          argv: process.argv,
          execArgv: process.execArgv,
        };
      }
      current = process;
      parent = globalThis;
    } else if (NODE_BUILTIN_LIST.includes(cleanRoot) || rootName.startsWith('node:')) {
      const modName = rootName.startsWith('node:') ? rootName : `node:${cleanRoot}`;
      current = await import(modName);
      parent = current;
    } else {
      try {
        current = await importProjectModule(rootName, rootDir);
        parent = current;
      } catch {
        if (rootName in globalThis) {
          current = (globalThis as any)[rootName];
          parent = globalThis;
        } else {
          throw new Error(`Module "${rootName}" could not be resolved`);
        }
      }
    }
    startIndex = 1;
  }

  for (let i = startIndex; i < pathSegments.length; i++) {
    const seg = pathSegments[i];
    if (current == null) {
      throw new TypeError(
        'Cannot read property "' + seg + '" of ' + current + ' at path "' + pathSegments.slice(0, i).join('.') + '"'
      );
    }
    if (typeof current?.then === 'function') {
      current = await current;
    }
    parent = current;
    current = current[seg];
  }

  if (typeof current?.then === 'function') {
    current = await current;
  }

  if (isSet) {
    if (pathSegments.length > 0 && parent) {
      const lastSeg = pathSegments[pathSegments.length - 1];
      parent[lastSeg] = args ? args[0] : undefined;
      return parent[lastSeg];
    }
    return undefined;
  }

  if (isCall) {
    if (typeof current !== 'function') {
      if (typeof current?.default === 'function') {
        current = current.default;
      } else {
        throw new TypeError(
          'Path "' + pathSegments.join('.') + '" is not a function (type: ' + typeof current + ')'
        );
      }
    }

    let result: any;
    if (isConstructor) {
      result = Reflect.construct(current, args || []);
    } else {
      result = current.apply(parent, args || []);
    }

    if (result && typeof result.on === 'function' && typeof result.listeners === 'function') {
      if (result.listeners('error').length === 0) {
        let bufferedError: any = null;
        const defaultErrHandler = (err: any) => {
          bufferedError = err;
        };
        result.once('error', defaultErrHandler);

        const origOn = result.on.bind(result);
        result.on = function (event: string, fn: any) {
          if (event === 'error' && bufferedError) {
            const err = bufferedError;
            bufferedError = null;
            result.removeListener('error', defaultErrHandler);
            setTimeout(() => {
              if (typeof fn === 'function') fn(err);
            }, 0);
          }
          return origOn(event, fn);
        };
      }
    }

    return result;
  }

  return current;
}

// ── PARENT PORT EVENT LISTENER ──
parentPort.on('message', async (msg: any) => {
  if (msg.type === 'HTTP_SYNC_RPC') {
    try {
      const { id, parsed } = msg;
      const refId = parsed.refId || null;
      const pathSegments = Array.isArray(parsed.path)
        ? parsed.path
        : parsed.module
        ? [parsed.module, parsed.method].filter(Boolean)
        : [];
      const isCall = parsed.isCall !== undefined ? Boolean(parsed.isCall) : true;
      const isConstructor = Boolean(parsed.isConstructor);
      const isSet = Boolean(parsed.isSet);
      const rawArgs = parsed.args ?? null;
      const callArgs = rawArgs !== null ? unmarshallArgs(rawArgs, livingObjects) : null;

      const rawResult = await resolveNodePath(
        refId,
        pathSegments,
        callArgs,
        isCall,
        livingObjects,
        projectRoot,
        isConstructor,
        isSet
      );
      const result = await serializeForClientAsync(rawResult, livingObjects);
      parentPort.postMessage({ type: 'HTTP_SYNC_RES', id, ok: true, result });
    } catch (err: any) {
      parentPort.postMessage({
        type: 'HTTP_SYNC_RES',
        id: msg.id,
        ok: false,
        error: {
          message: err?.message || String(err),
          code: err?.code,
          stack: err?.stack,
        },
      });
    }
    return;
  }

  if (msg.type === 'WS_DATA') {
    const data = Buffer.from(msg.data);
    const opcode = data[0];

    // 0x01 = PING
    if (opcode === 0x01 && data.length >= 9) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const clientTimestamp = Number(view.getBigUint64(1));
      const resPacket = Buffer.alloc(22);
      resPacket[0] = 0x02; // PONG
      const resView = new DataView(resPacket.buffer, resPacket.byteOffset, resPacket.byteLength);
      resView.setBigUint64(1, BigInt(clientTimestamp));
      resView.setBigUint64(9, BigInt(Date.now()));
      resView.setUint32(17, Math.floor(process.uptime()));
      resPacket[21] = mode === 'production' ? 0x01 : 0x02;
      parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
      return;
    }

    function parseClientPayload(raw: Buffer | Uint8Array): any {
      try {
        return lumianaDecode(raw);
      } catch {
        const text = new TextDecoder().decode(raw);
        return JSON.parse(text);
      }
    }

    // 0x03 = RUN_FUNCTION
    if (opcode === 0x03) {
      let req: any;
      try {
        req = parseClientPayload(data.subarray(1));

        const ctx = {
          os: await import('node:os'),
          fs: await import('node:fs'),
          path: await import('node:path'),
          process,
          import: (mod: string) => importProjectModule(mod, projectRoot),
        };

        let fn: any;
        try {
          fn = (0, eval)('(' + req.code + ')');
        } catch {
          const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
          fn = new AsyncFn('ctx', '...args', req.code);
        }
        const rawResult = await fn(ctx, ...(req.args || []));
        const result = await serializeForClientAsync(rawResult, livingObjects);
        const resPayload = lumianaEncode({ id: req.id, ok: true, result });
        const resPacket = Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)]);
        parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
      } catch (err: any) {
        try {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const resPayload = lumianaEncode({ id: req?.id, ok: false, error: errorMsg });
          const resPacket = Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)]);
          parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
        } catch {}
      }
      return;
    }

    // 0x05 = NODE_CALL
    if (opcode === 0x05) {
      let req: any;
      try {
        req = parseClientPayload(data.subarray(1));

        const refId = req.refId || null;
        const pathSegments = Array.isArray(req.path)
          ? req.path
          : req.module
          ? [req.module, req.method].filter(Boolean)
          : [];
        const isCall = req.isCall !== undefined ? Boolean(req.isCall) : true;
        const isConstructor = Boolean(req.isConstructor);
        const rawArgs = req.args ?? null;
        const callArgs = rawArgs !== null ? unmarshallArgs(rawArgs, livingObjects) : null;

        const rawResult = await resolveNodePath(
          refId,
          pathSegments,
          callArgs,
          isCall,
          livingObjects,
          projectRoot,
          isConstructor
        );
        const result = await serializeForClientAsync(rawResult, livingObjects);
        const resPayload = lumianaEncode({ id: req.id, ok: true, result });
        const resPacket = Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)]);
        parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
      } catch (err: any) {
        try {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const resPayload = lumianaEncode({
            id: req?.id,
            ok: false,
            error: errorMsg,
            code: err?.code,
            stack: err?.stack,
          });
          const resPacket = Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)]);
          parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
        } catch {}
      }
      return;
    }

    // 0x08 = CALLBACK_RESPONSE
    if (opcode === 0x08) {
      try {
        const msg = parseClientPayload(data.subarray(1));
        const pending = pendingCallbacks.get(msg.callId);
        if (pending) {
          pendingCallbacks.delete(msg.callId);
          if (msg.ok) {
            if (msg.result && typeof msg.result === 'object' && msg.result.__lumiana_response__) {
              const respData = msg.result;
              const isNullBody = [101, 204, 205, 304].includes(respData.status) || !respData.body;
              const bodyBuf = isNullBody
                ? null
                : Array.isArray(respData.body)
                ? new Uint8Array(respData.body)
                : respData.body;
              const nodeResponse = new Response(bodyBuf, {
                status: respData.status,
                statusText: respData.statusText,
                headers: respData.headers,
              });
              pending.resolve(nodeResponse);
            } else {
              pending.resolve(unmarshallArgs([msg.result], livingObjects)[0]);
            }
          } else {
            pending.reject(new Error(msg.error || 'Callback invocation error'));
          }
        }
      } catch (err) {
        console.error('[Lumiana Worker] Failed to handle callback response:', err);
      }
      return;
    }
  }
});
