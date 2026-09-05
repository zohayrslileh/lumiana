// @ts-nocheck
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

if (!parentPort) {
  throw new Error('[Lumiana Worker] This file must be executed inside a worker thread.');
}

const projectRoot: string = workerData?.projectRoot || process.cwd();
const mode: string = workerData?.mode || 'development';
const livingObjects = new Map<string, any>();
const pendingCallbacks = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

function serializeForClient(value: any, livingObjects: Map<string, any>): any {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { __lumiana_bin__: Array.from(value) };
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
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
    const refId = 'ref_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    livingObjects.set(refId, value);
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
      ]) {
        if (key in value) props[key] = value[key];
      }
    }
    return { __lumiana_ref__: refId, __props__: props };
  }
  if (Array.isArray(value)) {
    return value.map((v) => serializeForClient(v, livingObjects));
  }
  if (t === 'object' && (proto === null || proto === Object.prototype)) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = serializeForClient(v, livingObjects);
    }
    return obj;
  }
  return value;
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
    if (typeof arg === 'object') {
      if (arg.__lumiana_cb__) {
        const cbId = arg.__lumiana_cb__;
        return async (...cbArgs: any[]) => {
          try {
            const callId = 'call_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
            const serializedCbArgs = await Promise.all(
              cbArgs.map((a) => serializeForClientAsync(a, livingObjects))
            );
            const payload = JSON.stringify({ callId, cbId, args: serializedCbArgs });
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
      if (arg.__lumiana_bin__) {
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

async function importProjectModule(modName: string, rootDir: string): Promise<any> {
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
  isConstructor: boolean = false
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
    if (rootName === 'process') {
      current = process;
      parent = globalThis;
    } else if (rootName in globalThis) {
      current = (globalThis as any)[rootName];
      parent = globalThis;
    } else {
      try {
        current = await importProjectModule(rootName, rootDir);
      } catch {
        const modName = rootName.startsWith('node:') ? rootName : 'node:' + rootName;
        try {
          current = await import(modName);
        } catch {
          current = await import(rootName);
        }
      }
      parent = current;
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

  if (isCall) {
    if (typeof current !== 'function') {
      if (typeof current?.default === 'function') {
        current = current.default;
      } else if (args && args.length === 1 && parent && pathSegments.length > 0) {
        const lastSeg = pathSegments[pathSegments.length - 1];
        parent[lastSeg] = args[0];
        return args[0];
      } else {
        throw new TypeError(
          'Path "' + pathSegments.join('.') + '" is not a function (type: ' + typeof current + ')'
        );
      }
    }

    if (isConstructor) {
      return Reflect.construct(current, args || []);
    } else {
      return current.apply(parent, args || []);
    }
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
      const rawArgs = parsed.args ?? null;
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

    // 0x03 = RUN_FUNCTION
    if (opcode === 0x03) {
      try {
        const text = new TextDecoder().decode(data.subarray(1));
        const req = JSON.parse(text);

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
        const resPayload = JSON.stringify({ id: req.id, ok: true, result });
        const resPacket = Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)]);
        parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
      } catch (err: any) {
        try {
          const text = new TextDecoder().decode(data.subarray(1));
          const req = JSON.parse(text);
          const errorMsg = err instanceof Error ? err.message : String(err);
          const resPayload = JSON.stringify({ id: req.id, ok: false, error: errorMsg });
          const resPacket = Buffer.concat([Buffer.from([0x04]), Buffer.from(resPayload)]);
          parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
        } catch {}
      }
      return;
    }

    // 0x05 = NODE_CALL
    if (opcode === 0x05) {
      try {
        const text = new TextDecoder().decode(data.subarray(1));
        const req = JSON.parse(text);

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
        const resPayload = JSON.stringify({ id: req.id, ok: true, result });
        const resPacket = Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)]);
        parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
      } catch (err: any) {
        try {
          const text = new TextDecoder().decode(data.subarray(1));
          const req = JSON.parse(text);
          const errorMsg = err instanceof Error ? err.message : String(err);
          const resPayload = JSON.stringify({ id: req.id, ok: false, error: errorMsg });
          const resPacket = Buffer.concat([Buffer.from([0x06]), Buffer.from(resPayload)]);
          parentPort.postMessage({ type: 'WS_SEND', data: resPacket });
        } catch {}
      }
      return;
    }

    // 0x08 = CALLBACK_RESPONSE
    if (opcode === 0x08) {
      try {
        const text = new TextDecoder().decode(data.subarray(1));
        const msg = JSON.parse(text);
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
