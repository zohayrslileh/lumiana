# Project memory

The user designated `agent/` as the assistant's project memory on 2026-09-05.
Read this file when resuming work. Keep durable decisions, findings, and remaining
work here. Verify details against source and never store credentials or secrets.

## Working agreements

- Use Bun 1.3.14 for package management and scripts. Node.js remains the runtime;
  use `bun run test`, not `bun test`.
- The example consumes this checkout through `lumiana: "link:lumiana"`. Build and
  register the root with `bun link` before installing the example.
- Keep the public API small and preserve it while the runtime changes.
- Explain causes and contracts. Do not fix consumers with package-name exceptions,
  allowlists, cached reflection, or other behavior-changing workarounds.
- The browser owns everything that JavaScript can implement locally. Only operating
  system operations and genuinely native implementations cross the connection.
- Instances consume runtime contracts; Express, Elysia, Fastify, Hono, and other
  packages must never define shared abstractions.
- The user authorizes routine project work without repeated confirmation.

## Public contract

- `lumiana()` from `lumiana` is the Vite plugin.
- `lumiana`, `connect`, `node`, and `Buffer` are exported from `lumiana/client`.
- `await connect.credentials({ username, password, url? })` activates and returns
  the single browser-context instance. Repeating the same connection returns it;
  concurrent or different active connections throw.
- `lumiana.status()` reports the main server status. `lumiana.disconnect()` ends
  the connection and its dedicated Worker. Either side stopping stops the other.
- Imports remain ordinary Node package/builtin imports. `node(specifier)` is an
  optional explicit native resolver and rejects before connection.
- Credentials are configured under `defaultCredentials`. `LUMIANA_USERNAME` and
  `LUMIANA_PASSWORD` override them. Standalone production uses `LUMIANA_HOST` and
  `LUMIANA_PORT`.
- `nodeModules` explicitly excludes matching packages. Other packages are bundled
  unless resolution or build analysis proves they cannot be bundled. Importing a
  Node builtin alone is never grounds for exclusion.
- Vite dev, Vite preview, and standalone deployment are supported.

## Architecture

- Work is on branch `runtime/remote-kernel`; the first kernel milestone is commit
  `ed89f9f`.
- The browser-owned runtime contains ordinary local objects, constructors, streams,
  event emitters, callbacks, and binary buffers. The Worker owns opaque operating
  system handles. Kernel commands/events use the existing binary MessagePack
  WebSocket and close with their connection.
- Runtime contracts currently exist for `node:fs/promises`, `node:net`, and the
  HTTP server half of `node:http`. Filesystem handles, TCP/Unix sockets, and HTTP
  listeners live in the Worker; all surrounding JavaScript behavior is local.
- Pure/local builtins currently include assert, buffer, crypto, events, module,
  path, process state, querystring, stream, stream/promises, string_decoder,
  timers, url, util, and zlib. Crypto fills arbitrary-sized binary views by
  respecting Web Crypto's 65,536-byte call limit.
- `node:https`, `node:http2`, and `node:tls` expose local import-time facades. Their
  current operational methods still use native execution because their socket and
  protocol runtime domains have not yet been implemented locally.
- Implicit `process` is a stable local object initialized from a plain snapshot at
  authenticated connection. `process.env` is a null-prototype object; reads and
  `JSON.stringify(process.env)` make zero boundary calls.
- `node:module` has a local `createRequire`. The compiler preserves each source
  module's origin. Supported CommonJS builtins return local constructors. Static
  missing optional dependencies are proven at build time and throw local
  `MODULE_NOT_FOUND`, allowing a package's own JavaScript fallback without a call.
- Dependency modules that explicitly consume the Node execution contract resolve
  their dependencies with Node export conditions. Application composition roots
  retain browser conditions for unrelated imports. This selects Node adapters
  from conditional packages through source semantics, without package names.
- `global` resolves to `globalThis`. Unbound `setImmediate`/`clearImmediate` use the
  local timer runtime. Dynamic or genuinely native module resolution stays remote.
- Unqualified `fetch` and `WebSocket` use hybrid routing: same-origin stays in the
  browser and other origins execute remotely. Explicit `window.*` stays local.
- Primitive values and plain records copy. Functions, class instances, symbols,
  arrays, and other non-plain values retain owner references. Binary values remain
  binary through MessagePack.

## Validation and findings

- Real Express 5 runs with its application graph local and zero synchronous XHR at
  startup. HTTP requests reach the Worker listener and execute browser callbacks.
- Real Fastify 5 serves successfully after keeping `util.inherits`, constructors,
  and prototype mutation in one local identity domain.
- Real Elysia 1.4 with `@elysia/node` works in Vite 8 dev and preview. Its source
  selects the Node `srvx` adapter, `GET /` returns `200 Hello Elysia`, and startup
  now makes zero synchronous boundary calls (previously 26).
- HTTP response handles remain valid until the browser stream's ordered `end()`
  command completes. A declared content length can make Node emit `close` before
  that command arrives. Writes acknowledge immediately when Node reports no
  backpressure; this removes the close/end race without hiding invalid writes.
- Elysia's 26 calls were not one problem: global/timer reflection, crypto/zlib and
  stream imports, TLS/HTTP facades, and two absent CrossWS accelerators. Local
  runtime contracts removed the first groups. Build-time module availability
  removed `bufferutil` and `utf-8-validate` calls by preserving CrossWS's own
  fallback semantics.
- The canonical suite passes 21 tests, including CommonJS format preservation,
  1 MiB local random fill, binary
  gzip round trips, and local failure of statically absent optional dependencies.
  Type checking and the production example build pass.
- CommonJS sources must never receive injected ESM imports or browser runtime
  `require()` calls. Connection-dependent helpers are read from the internal
  `Symbol.for('lumiana.runtime')` browser-context registry initialized by the
  client. The reference-reader primitive bootstraps independently through
  `Symbol.for('lumiana.readPath')` and its shared WeakMap, avoiding a cycle when
  the client itself loads CommonJS dependencies such as `buffer`.
- The real `@phreshos/node` 0.1.15 example now builds and runs in both Vite 8 dev
  and preview. `System.connect()` succeeds and `system.program.list()` returns an
  array. Its current startup makes 28 synchronous native calls, mainly synchronous
  filesystem, OS, child-process, and Jiti VM/module operations; these belong to
  runtime domains still awaiting local object models and transaction support.
- A packet-level trace accounts for all 28 PhreshOS calls: 10 static native binding
  loads (`fs`, `os`, and `child_process`), 7 whole-module loads from AdmZip/Jiti
  (`fs`, `os`, `v8`, `tty`, `perf_hooks`, and `vm`), 7 Jiti compatibility/reflection
  operations, and 4 actual startup calls (two `homedir()`, `existsSync()`, and
  `realpathSync()`). The Unix-socket connection and `program.list()` use the async
  MessagePack WebSocket and add no synchronous XHR. The package root re-exports
  Project/storage/shell modules and has no `sideEffects: false`, while eager remote
  binding acquisition is itself a side effect, so the bundler cannot discard those
  otherwise unused paths. Local builtin module objects should remove the 24 setup
  calls; local OS snapshots remove `homedir`, leaving the genuinely synchronous
  filesystem decisions for the general transaction/async-lifting design.

## Remaining runtime domains

- Callback and synchronous `node:fs`, file streams, watchers, and complete metadata.
- HTTP clients, upgrades, full backpressure, TLS and HTTP/2 local object models.
- DNS, UDP, child processes, worker threads, async context, and process lifecycle.
- Native-addon adapters and broader compatibility fixtures for server, filesystem,
  socket, and native-environment packages.
- A general asynchronous transaction/compiler model for synchronous-looking source
  operations that must cross. Existing synchronous native references still use XHR.
