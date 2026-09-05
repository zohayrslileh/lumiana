// @ts-nocheck
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
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

export interface LumianaPluginOptions {
  /**
   * Internal WebSocket authentication username (default: 'lumiana')
   */
  username?: string;
  /**
   * Internal WebSocket authentication password (default: 'lumiana')
   */
  password?: string;
  /**
   * Additional Node modules to optimize or treat as Node target
   */
  nodeModules?: (string | RegExp)[];
}

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var PORT = 3883;
var WS_PATH = "/lumiana-ws";

function getWorkerPath() {
  const p1 = path.resolve(__dirname, 'worker.js');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(__dirname, '../dist/worker.js');
  if (fs.existsSync(p2)) return p2;
  return p1;
}
function acceptKey(key) {
  return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function verifyAuth(req, expectedUser, expectedPass) {
  try {
    const url = new URL(req.url || "", "http://localhost");
    const u = url.searchParams.get("username") || url.searchParams.get("u");
    const p = url.searchParams.get("password") || url.searchParams.get("p");
    if (u === expectedUser && p === expectedPass) {
      return true;
    }
    const auth = req.headers["authorization"];
    if (auth && auth.startsWith("Basic ")) {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const [headerUser, headerPass] = decoded.split(":");
      if (headerUser === expectedUser && headerPass === expectedPass) {
        return true;
      }
    }
    const xAuth = req.headers["x-lumiana-auth"];
    if (xAuth) {
      const decoded = Buffer.from(String(xAuth), "base64").toString("utf8");
      const [headerUser, headerPass] = decoded.split(":");
      if (headerUser === expectedUser && headerPass === expectedPass) {
        return true;
      }
    }
  } catch {
  }
  return false;
}
function encodeBinaryFrame(payload) {
  const len = payload.length;
  if (len < 126) {
    const buf = Buffer.allocUnsafe(2 + len);
    buf[0] = 130;
    buf[1] = len;
    buf.set(payload, 2);
    return buf;
  } else if (len < 65536) {
    const buf = Buffer.allocUnsafe(4 + len);
    buf[0] = 130;
    buf[1] = 126;
    buf.writeUInt16BE(len, 2);
    buf.set(payload, 4);
    return buf;
  } else {
    const buf = Buffer.allocUnsafe(10 + len);
    buf[0] = 130;
    buf[1] = 127;
    buf.writeBigUInt64BE(BigInt(len), 2);
    buf.set(payload, 10);
    return buf;
  }
}
function decodeBinaryFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 15;
  const isMasked = (buffer[1] & 128) !== 0;
  let payloadLen = buffer[1] & 127;
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

var NODE_BUILTIN_PREFIX = "\0lumiana-node:";
var NODE_BUILTIN_LIST = [
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib"
];
async function importProjectModule(modName, projectRoot = process.cwd()) {
  const cleanId = modName.startsWith("node:") ? modName.slice(5) : modName;
  if (NODE_BUILTIN_LIST.includes(cleanId) || modName.startsWith("node:")) {
    return modName.startsWith("node:") ? import(modName) : import(`node:${modName}`);
  }
  try {
    const req = createRequire(path.join(projectRoot, "package.json"));
    const resolved = req.resolve(modName);
    try {
      return await import(pathToFileURL(resolved).href);
    } catch {
      return req(resolved);
    }
  } catch {
    try {
      const req = createRequire(path.join(process.cwd(), "dummy.js"));
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
function isNodeTargetModule(id, options) {
  if (id.startsWith("\0") || id.startsWith("/@") || id.startsWith(".") || id.startsWith("/") || id.includes("?")) {
    return false;
  }
  const cleanId = id.startsWith("node:") ? id.slice(5) : id;
  if (id.startsWith("node:") || NODE_BUILTIN_LIST.includes(cleanId)) {
    return true;
  }
  const customList = options?.nodeModules || [];
  for (const item of customList) {
    if (typeof item === "string") {
      if (item === "*" || cleanId === item || cleanId.startsWith(item + "/")) {
        return true;
      }
    } else if (item instanceof RegExp && item.test(cleanId)) {
      return true;
    }
  }
  return false;
}
var latestActiveWorker = null;
var activeWorkers = new Set();

function handleWebSocketUpgrade(req, socket, mode, username, password, projectRoot = process.cwd()) {
  if (!verifyAuth(req, username, password)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = acceptKey(key);
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: ${accept}\r
\r
`
  );

  const worker = new Worker(getWorkerPath(), {
    workerData: { projectRoot, mode },
  });

  activeWorkers.add(worker);
  latestActiveWorker = worker;

  worker.on("message", (msg) => {
    if (msg?.type === "WS_SEND") {
      const data = Buffer.isBuffer(msg.data) ? msg.data : Buffer.from(msg.data);
      socket.write(encodeBinaryFrame(data));
    }
  });

  worker.on("error", (err) => {
    console.error("[Lumiana Worker Error]", err);
  });

  worker.on("exit", (code) => {
    activeWorkers.delete(worker);
    if (latestActiveWorker === worker) {
      latestActiveWorker = null;
    }
    if (code !== 0 && code !== 1 && code !== null) {
      console.error(`[Lumiana Worker Exit] Worker stopped with exit code ${code}`);
    }
  });

  socket.on("data", (chunk) => {
    const frame = decodeBinaryFrame(chunk);
    if (!frame) return;
    if (frame.opcode === 8) {
      socket.end();
      return;
    }
    if (frame.opcode === 2) {
      worker.postMessage({ type: "WS_DATA", data: frame.data });
    }
  });

  const cleanup = () => {
    activeWorkers.delete(worker);
    if (latestActiveWorker === worker) {
      latestActiveWorker = null;
    }
    worker.terminate().catch(() => {});
  };

  socket.on("close", cleanup);
  socket.on("error", () => {
    socket.destroy();
    cleanup();
  });
}

async function handleSyncHttpRequest(req, res, expectedUser, expectedPass) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-lumiana-auth");
    res.writeHead(204);
    res.end();
    return;
  }
  if (expectedUser && expectedPass && !verifyAuth(req, expectedUser, expectedPass)) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.writeHead(401);
    res.end(JSON.stringify({ ok: false, error: { message: "Unauthorized: invalid credentials" } }));
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const parsed = JSON.parse(body || "{}");
      const targetWorker = latestActiveWorker;
      if (!targetWorker) {
        throw new Error("No active Lumiana connection/worker available for sync RPC");
      }
      const syncId = "sync_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const resMsg = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Sync RPC timeout after 30s"));
        }, 30000);
        const onMessage = (msg) => {
          if (msg?.type === "HTTP_SYNC_RES" && msg.id === syncId) {
            clearTimeout(timer);
            cleanup();
            resolve(msg);
          }
        };
        const cleanup = () => {
          targetWorker.off("message", onMessage);
        };
        targetWorker.on("message", onMessage);
        targetWorker.postMessage({
          type: "HTTP_SYNC_RPC",
          id: syncId,
          parsed,
        });
      });

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.writeHead(200);
      res.end(JSON.stringify({ ok: resMsg.ok, result: resMsg.result, error: resMsg.error }));
    } catch (err) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
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
function lumiana(options = {}) {
  const username = options.username ?? "lumiana";
  const password = options.password ?? "lumiana";
  let baseOutDir = "dist";
  let projectRoot = process.cwd();
  let isBuild = false;
  return {
    name: "lumiana",
    enforce: "pre",
    config(config, env) {
      isBuild = env.command === "build";
      projectRoot = config.root ? path.resolve(config.root) : process.cwd();
      baseOutDir = path.resolve(projectRoot, config.build?.outDir || "dist");
      const nodeBuiltins = [
        ...NODE_BUILTIN_LIST,
        ...NODE_BUILTIN_LIST.map((m) => `node:${m}`)
      ];
      const customExcluded = [];
      if (options.nodeModules) {
        for (const m of options.nodeModules) {
          if (typeof m === "string" && m !== "*") customExcluded.push(m);
        }
      }
      let isVite8OrAbove = false;
      try {
        const req = createRequire(path.join(projectRoot, "dummy.js"));
        const vitePkg = req("vite/package.json");
        const major = parseInt(String(vitePkg.version).split(".")[0], 10);
        if (major >= 8) isVite8OrAbove = true;
      } catch {
        try {
          const req = createRequire(import.meta.url);
          const vitePkg = req("vite/package.json");
          const major = parseInt(String(vitePkg.version).split(".")[0], 10);
          if (major >= 8) isVite8OrAbove = true;
        } catch {
          isVite8OrAbove = Boolean(config?.optimizeDeps?.rolldownOptions);
        }
      }
      const optimizeDepsConfig = {
        exclude: [...nodeBuiltins, ...customExcluded]
      };
      if (isVite8OrAbove) {
        optimizeDepsConfig.rolldownOptions = {
          plugins: [
            {
              name: "lumiana-externalize-node-builtins",
              resolveId(id) {
                const clean = id.startsWith("node:") ? id.slice(5) : id;
                if (id.startsWith("node:") || NODE_BUILTIN_LIST.includes(clean)) {
                  return { id, external: true };
                }
                if (customExcluded.includes(id) || customExcluded.includes(clean)) {
                  return { id, external: true };
                }
              }
            }
          ]
        };
      } else {
        optimizeDepsConfig.esbuildOptions = {
          plugins: [
            {
              name: "lumiana-externalize-node-builtins",
              setup(build) {
                const filter = /^(node:)?[a-zA-Z0-9_\/]+$/;
                build.onResolve({ filter }, (args) => {
                  const clean = args.path.startsWith("node:") ? args.path.slice(5) : args.path;
                  if (args.path.startsWith("node:") || NODE_BUILTIN_LIST.includes(clean)) {
                    return { path: args.path, external: true };
                  }
                  if (customExcluded.includes(args.path) || customExcluded.includes(clean)) {
                    return { path: args.path, external: true };
                  }
                });
              }
            }
          ]
        };
      }
      return {
        optimizeDeps: optimizeDepsConfig,
        ...isBuild ? {
          build: {
            outDir: path.join(baseOutDir, "client"),
            emptyOutDir: true
          }
        } : {}
      };
    },
    resolveId(id) {
      if (id === "virtual:lumiana" || id === "lumiana" || id === "lumiana/client") {
        return "\0virtual:lumiana";
      }
      if (id.startsWith("\0") || id.startsWith("/@") || id.startsWith(".") || id.startsWith("/")) {
        return;
      }
      const cleanId = id.startsWith("node:") ? id.slice(5) : id;
      if (isNodeTargetModule(id, options)) {
        return `${NODE_BUILTIN_PREFIX}${cleanId}`;
      }
    },
    async load(id) {
      if (id === "\0virtual:lumiana") {
        const jsPath = path.resolve(__dirname, "client.js");
        if (fs.existsSync(jsPath)) {
          return fs.readFileSync(jsPath, "utf-8");
        }
        const tsPath = path.resolve(__dirname, "client.ts");
        if (fs.existsSync(tsPath)) {
          return fs.readFileSync(tsPath, "utf-8");
        }
      }
      if (id.startsWith(NODE_BUILTIN_PREFIX)) {
        const modName = id.slice(NODE_BUILTIN_PREFIX.length);
        if (modName === "path" || modName === "path/posix" || modName === "path/win32") {
          return IN_MEMORY_PATH_CODE;
        }
        if (modName === "events") {
          return IN_MEMORY_EVENTS_CODE;
        }
        if (modName === "util") {
          return IN_MEMORY_UTIL_CODE;
        }
        if (modName === "util/types") {
          return IN_MEMORY_UTIL_TYPES_CODE;
        }
        if (modName === "buffer") {
          return IN_MEMORY_BUFFER_CODE;
        }
        if (modName === "process") {
          return IN_MEMORY_PROCESS_CODE;
        }
        if (modName === "assert") {
          return IN_MEMORY_ASSERT_CODE;
        }
        if (modName === "string_decoder") {
          return IN_MEMORY_STRING_DECODER_CODE;
        }
        try {
          const realMod = await importProjectModule(modName, projectRoot);
          const targetMod = realMod && typeof realMod === "object" && "default" in realMod && Object.keys(realMod).length === 1 ? realMod.default : realMod;
          const rawKeys = targetMod && (typeof targetMod === "object" || typeof targetMod === "function") ? Object.keys(targetMod).concat(realMod && realMod !== targetMod ? Object.keys(realMod) : []) : [];
          const keys = Array.from(new Set(rawKeys)).filter(
            (k) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) && k !== "default"
          );
          const nonFuncs = keys.filter(
            (k) => typeof realMod?.[k] !== "function" && typeof targetMod?.[k] !== "function"
          );
          const staticValues = {};
          for (const nf of nonFuncs) {
            try {
              const v = targetMod?.[nf] ?? realMod?.[nf];
              if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
                staticValues[nf] = v;
              } else if (v && typeof v === "object" && !Array.isArray(v)) {
                staticValues[nf] = { ...v };
              }
            } catch {
            }
          }
          return `
import { createNodeModuleProxy } from 'virtual:lumiana';

const _modName = ${JSON.stringify(modName)};
const _staticValues = ${JSON.stringify(staticValues)};
const _mod = createNodeModuleProxy(_modName, [_modName], null, _staticValues);

export default _mod;
${keys.map((k) => `export const ${k} = _mod[${JSON.stringify(k)}];`).join("\n")}
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
      projectRoot = server.config.root ? path.resolve(server.config.root) : projectRoot;
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith("/__lumiana_sync_node__")) {
          handleSyncHttpRequest(req, res, username, password);
          return;
        }
        next();
      });
      server.httpServer?.on("upgrade", (req, socket) => {
        if (req.url?.startsWith(WS_PATH)) {
          handleWebSocketUpgrade(req, socket, "development", username, password, projectRoot);
        }
      });
      const terminateAllWorkers = () => {
        for (const w of activeWorkers) {
          w.terminate().catch(() => {});
        }
        activeWorkers.clear();
        latestActiveWorker = null;
      };
      server.httpServer?.on("close", terminateAllWorkers);
      process.once("SIGINT", terminateAllWorkers);
      process.once("SIGTERM", terminateAllWorkers);
      process.once("exit", terminateAllWorkers);
    },
    // 2. In Build: Inverted production build generating main.js with binary remote execution
    closeBundle() {
      if (!isBuild) return;
      const workerSrc = getWorkerPath();
      fs.mkdirSync(baseOutDir, { recursive: true });
      if (fs.existsSync(workerSrc)) {
        fs.copyFileSync(workerSrc, path.join(baseOutDir, 'worker.js'));
      }
      const mainJsContent = `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, 'client');
const workerPath = path.resolve(__dirname, 'worker.js');

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

let latestActiveWorker = null;
const activeWorkers = new Set();

const server = http.createServer(async (req, res) => {
  if (req.url && req.url.startsWith('/__lumiana_sync_node__')) {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-lumiana-auth');
      res.writeHead(204);
      res.end();
      return;
    }
    if (!verifyAuth(req, USERNAME, PASSWORD)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(401);
      res.end(JSON.stringify({ ok: false, error: { message: 'Unauthorized: invalid credentials' } }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const targetWorker = latestActiveWorker;
        if (!targetWorker) {
          throw new Error('No active Lumiana connection/worker available for sync RPC');
        }
        const syncId = 'sync_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        const resMsg = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Sync RPC timeout after 30s'));
          }, 30000);
          const onMessage = (msg) => {
            if (msg?.type === 'HTTP_SYNC_RES' && msg.id === syncId) {
              clearTimeout(timer);
              cleanup();
              resolve(msg);
            }
          };
          const cleanup = () => {
            targetWorker.off('message', onMessage);
          };
          targetWorker.on('message', onMessage);
          targetWorker.postMessage({
            type: 'HTTP_SYNC_RPC',
            id: syncId,
            parsed,
          });
        });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: resMsg.ok, result: resMsg.result, error: resMsg.error }));
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
          },
        }));
      }
    });
    return;
  }

  // Static file serving
  let filePath = path.join(clientDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(clientDir, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith(WS_PATH)) {
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
    'Sec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n'
  );

  const worker = new Worker(workerPath, {
    workerData: { projectRoot: __dirname, mode: 'production' },
  });

  activeWorkers.add(worker);
  latestActiveWorker = worker;

  worker.on('message', (msg) => {
    if (msg?.type === 'WS_SEND') {
      const data = Buffer.isBuffer(msg.data) ? msg.data : Buffer.from(msg.data);
      socket.write(encodeBinaryFrame(data));
    }
  });

  worker.on('error', (err) => {
    console.error('[Lumiana Worker Error]', err);
  });

  worker.on('exit', (code) => {
    activeWorkers.delete(worker);
    if (latestActiveWorker === worker) {
      latestActiveWorker = null;
    }
    if (code !== 0 && code !== 1 && code !== null) {
      console.error('[Lumiana Worker Exit] Worker stopped with exit code ' + code);
    }
  });

  socket.on('data', (chunk) => {
    const frame = decodeBinaryFrame(chunk);
    if (!frame) return;

    if (frame.opcode === 0x08) {
      socket.end();
      return;
    }

    if (frame.opcode === 0x02) {
      worker.postMessage({ type: 'WS_DATA', data: frame.data });
    }
  });

  const cleanup = () => {
    activeWorkers.delete(worker);
    if (latestActiveWorker === worker) {
      latestActiveWorker = null;
    }
    worker.terminate().catch(() => {});
  };

  socket.on('close', cleanup);
  socket.on('error', () => {
    socket.destroy();
    cleanup();
  });
});

const terminateAllWorkers = () => {
  for (const w of activeWorkers) {
    w.terminate().catch(() => {});
  }
  activeWorkers.clear();
  latestActiveWorker = null;
};

server.on('close', terminateAllWorkers);
process.once('SIGINT', terminateAllWorkers);
process.once('SIGTERM', terminateAllWorkers);
process.once('exit', terminateAllWorkers);

server.listen(PORT, () => {
  console.log('\\u26A1 Lumiana Authenticated Binary WebSocket Server running at ws://localhost:' + PORT + WS_PATH);
});
`;
      fs.writeFileSync(path.join(baseOutDir, 'main.js'), mainJsContent, 'utf-8');
      console.log('\u26A1 [Lumiana] Built standalone authenticated binary websocket server: dist/main.js');
    }
  };
}
var src_default = lumiana;
export {
  src_default as default,
  lumiana
};
