# Project memory

The user designated `agent/` as the assistant's project memory on 2026-09-05. Read this file when
resuming work. Verify details against source and never store credentials or secrets.

## Working agreements

- Use Bun 1.3.14 for package management and scripts. Node.js remains the deployed runtime. Use
  `bun run test`, not `bun test`.
- Keep the public API small. Explain causes and contracts. Do not add package-name exceptions,
  allowlists, or consumer-specific runtime behavior.
- The browser owns all JavaScript that can execute locally. Only operating-system commands and
  native-addon operations cross the connection.
- A concrete package consumes a runtime contract; Express, Elysia, Fastify, Hono, PhreshOS, and
  other packages never define shared abstractions.
- The examples consume the checkout through `lumiana: "link:lumiana"`. Build and register the root
  with `bun link` before reinstalling an example.
- The user authorizes routine project work without repeated confirmation.

## Public contract

- `lumiana()` is imported from `lumiana/vite`.
- `lumiana` and `connect` are imported from `lumiana/client`.
- `await connect.credentials({ username, password, url? })` activates and returns the single
  browser-context instance. The same active connection returns that instance. Concurrent or
  different active connections throw.
- Accessing the instance or a runtime capability before connection throws. `lumiana.status()`
  reports the main server. `lumiana.disconnect()` ends the connection and its dedicated Worker.
- Plugin credentials live in `defaultCredentials`. `LUMIANA_USERNAME` and `LUMIANA_PASSWORD`
  override them. Standalone production also reads `LUMIANA_HOST` and `LUMIANA_PORT`.
- There is no `node()`, public `Buffer`, or package allowlist. The plugin is currently exported from
  `lumiana/vite`; the requested root `lumiana` export and `nodeModules` plugin option have not yet
  been restored.
- Vite development, Vite preview, and standalone production are supported.

## Architecture

- Statically identifiable package JavaScript, module state, classes, callbacks, streams, and events
  stay in the browser. A runtime-computed `require()` has no build-time module identity, so it uses
  the native reference store; this is distinct from moving a statically known dependency graph.
- Primitive values, data-only records, arrays, dates, regular expressions, and binary views copy
  through MessagePack. Cycles are retained. Functions and behavioral objects are rejected by the
  value boundary and require an explicit capability contract.
- Browser-owned runtime objects contain private, connection-owned handles for files, watchers,
  child processes, TCP/Unix sockets, HTTP listeners, WebSockets, DNS resolvers, and native-addon
  resources.
- CommonJS `require.resolve()` stays synchronous and is anchored to the package source represented
  in the browser bundle. The engine performs only the filesystem/module-resolution decision and
  returns the resolved path. Packages that address runtime resources this way are retained in the
  production manifest automatically while their JavaScript stays bundled.
- A package that performs a runtime-computed `require()` is also retained in the production
  manifest. Its JavaScript remains in the browser bundle; the dependency entry exists so the
  production package installation provides native binaries and other runtime-addressed files.
- Async commands and events use the established binary WebSocket. Inherently synchronous Node
  operations use one synchronous HTTP call. Large synchronous replies are gzip compressed.
- Native `.node` imports are detected automatically. Package JavaScript stays bundled; only the
  package owning the binary is added to the production server manifest. Native entry points and
  returned native resources have local browser objects backed by private handles. Callback
  capabilities preserve browser callback identity and support synchronous and asynchronous addon
  callbacks.
- Static CommonJS addon-locator calls such as `require(loader)('binding.node')` are resolved from
  the installed package at build time. This is based on call shape and matching binary evidence,
  never a loader or consumer package name. The result uses the same native-addon capability as a
  direct `.node` import.
- If a loader computes its request and passes it to dynamic `require`, Lumiana keeps the path
  computation local and represents the loaded native value through the same reference store.
  Statically identified JavaScript dependencies still stay in the browser bundle. Addon discovery
  prefers an exact basename, then a single binary for the build platform and architecture, and
  rejects ambiguity.
- A statically named unavailable `require()` throws at that call, and a statically named
  unavailable `import()` returns a rejected Promise at that expression. This preserves the
  package's own optional-dependency fallback without leaving an unresolved import for Vite.
- Dependency modules that explicitly consume the Node execution contract resolve their own
  conditional dependencies with Node conditions. A required export missing from a browser entry
  may select the package's Node entry, which is still bundled for the browser. This uses source and
  transitive export evidence from the active Vite resolver, never package names. Re-exported browser
  capabilities must be followed before deciding an export is missing.
- Bare and `node:` builtin specifiers establish the same Node execution provenance. Older CommonJS
  packages often use `require('fs')`; this must propagate Node globals and resolution exactly like
  `require('node:fs')`.
- Ambient dependency probes such as `typeof process` and `typeof setImmediate` remain browser-owned.
  Vite owns `process.env.NODE_ENV`. Lumiana injects implicit Node globals into application modules
  and dependencies with explicit Node provenance; it never infers ownership from a package name or
  a guarded global access.
- A guarded ambient fallback only avoids Node provenance when its control-flow condition proves the
  ambient value exists on that branch. This covers React's guarded `process.emit` fallback without
  misclassifying unsafe expressions such as `typeof process.emit`.
- Node provenance propagates across every resolved dependency edge of a selected local Node
  contract, including relative files and helper packages. This keeps its complete implementation
  graph in one execution domain without affecting ordinary browser dependency graphs.
- Node builtins with browser runtime contracts use those local contracts. Other builtins use the
  generic native reference store while the importing package remains browser-owned.
- Stable `process` and `node:os` information is copied once during connection. `process.env` is a
  local null-prototype object; property reads and `JSON.stringify(process.env)` make no calls.
- Unqualified `fetch` and `WebSocket` use hybrid routing. Same-origin traffic stays in the browser;
  other origins use the native network capability. Explicit `window.fetch` and `window.WebSocket`
  stay in the browser.
- HTTP is a browser runtime domain. HTTP/1 parsing and response framing, HTTP/2 framing and HPACK,
  flow control, multiplexing, and HTTP/HTTPS Agent scheduling stay local. The engine retains only
  the underlying sockets and native TLS resources.
- TLS certificate-chain validation and encryption remain native. Hostname matching, SNI, ALPN,
  PSK, and renegotiation completion callbacks execute in the browser. SNI may complete
  asynchronously; callbacks that the native TLS stack requires synchronously reject Promise
  results.

## Implemented runtime domains

- `node:fs`: callback, Promise, synchronous, stream, and watcher forms.
- `node:net`: TCP and Unix sockets with local Socket and Server objects.
- `node:http` and `node:https`: local client and server framing, streaming, upgrades, keep-alive,
  Agent pooling, request queues, connection limits, and custom connection factories.
- `node:http2`: client and server sessions over cleartext or TLS, HPACK, multiplexed streams,
  settings, ping, flow control, trailers, informational headers, server push, graceful shutdown,
  and secure HTTP/1 fallback.
- `node:tls`: client and server sockets, TCP upgrades, certificate validation, local hostname
  matching, secure contexts, ticket keys, SNI, ALPN, PSK, and TLS 1.2 renegotiation.
- `node:child_process`: local lifecycle objects, standard and arbitrary piped file descriptors,
  complete stream lifecycle events, callbacks, Promise customization, IPC commands, and
  synchronous variants.
- Local or snapshot-backed `assert`, `async_hooks` basics, `buffer`, `constants`, `crypto`, `events`,
  `module`, `os`, `path`, `perf_hooks`, `process`, `querystring`, `readline`, `stream`,
  `stream/promises`, `string_decoder`, `timers`, `tty`, `url`, `util`, `v8` serialization, `vm`
  basics, and `zlib`.
- `node:dns`: callback and Promise lookups/resolvers, plus synchronous resolver configuration.
- Hybrid Fetch and WebSocket with binary transport and abort support.
- `node:sqlite`: browser-owned API objects, iterators, tagged-statement caching, and callbacks;
  engine-owned native database, statement, iterator, and session handles.

## Verified findings

- Express 5, Fastify 5, Elysia 1.4 with `@elysia/node`, Hono, and PhreshOS were used to discover
  general runtime gaps. They remain consumers, not implementation branches.
- Express runs its application graph locally with zero synchronous startup calls. Elysia startup
  was reduced from 26 synchronous calls to zero by implementing missing local contracts rather
  than batching reflection. Fastify works because constructors and prototype mutation share one
  local identity domain.
- PhreshOS startup was reduced from 28 synchronous calls to the two real filesystem decisions,
  `existsSync()` and `realpathSync()`. Its Unix-socket traffic uses WebSocket.
- Native addon module loading materializes its behavioral property graph once, so exported methods
  and their prototypes are local references rather than repeated reflection calls. The Sharp image
  example was reduced from 14 synchronous requests to six: one addon load, four native calls, and
  one callback continuation from `pipeline()`'s synchronous queue notification.
- `process.env` serialization performs zero boundary calls. Large random fills are chunked around
  Web Crypto's 65,536-byte per-call limit.
- CommonJS sources never receive ESM syntax. Connection runtime helpers use the private
  `Symbol.for('lumiana.runtime')` registry.
- CommonJS `__filename` and `__dirname` are local module metadata. Their build-relative origins are
  resolved against the connection's module root, separately from `process.cwd()`, so reads make no
  boundary call and production paths remain relocatable regardless of the launch directory.
- The value serializer must reject object-shaped behavior. Class prototypes can have
  `Object.prototype` while carrying non-enumerable methods; copying them as records breaks
  prototypes and `instanceof`.
- HTTP/HTTPS Agents reuse sockets without engine scheduling calls. Pool keys distinguish TLS
  context and validation identities, and queued requests obey per-origin and total connection
  limits.
- HTTP/2 interoperates in both directions with native Node peers. Its protocol machinery remains
  local, coalesces outgoing frames, rejects invalid settings, handles repeated identical ping
  payloads, closes requests queued before connection without leaving them pending, and preserves
  native EOF delivery when a consumer pauses after the final data frame.
- The compatibility suite contains 17 browser examples. All 17 passed in Vite production preview,
  and the `node:sqlite` case also passed in Vite development and standalone production launched from
  the repository root; the previous 16-case suite passed in both modes. The separate Playwright
  example launches Chromium, reads a page, and closes cleanly in Vite development and production
  preview. The esbuild example compiles TypeScript in the browser in development and standalone
  production; its executable package is inferred from `require.resolve()` and retained in the
  deployment manifest. The React example runs `better-sqlite3` JavaScript in the browser and loads
  its native binary through the engine; the generated production manifest retains the package for
  installation. Per-instance callback and Promise DNS resolvers retain their native resolver state
  in the engine, while the resolver API stays local. The root suite passed 83 tests; typecheck and
  both builds passed. Formatting passed after applying Prettier and should be rechecked after
  subsequent edits. These counts describe the current uncommitted worktree and must be updated when
  the suite changes.
- The published browser client has no raw `node:buffer` dependency, so importing it cannot produce
  Vite's browser-external stub even before the Lumiana plugin participates in resolution.
- Optimized dependency output is keyed by a content fingerprint of Lumiana's installed Vite
  transformer. Rebuilding or updating a linked Lumiana checkout invalidates stale transformed
  dependencies without requiring consumers to delete `node_modules/.vite` or pass `--force`.

## Remaining runtime domains

- Complete file-descriptor mutation, incremental file streams, directory handles, recursive
  watcher parity, and full filesystem metadata.
- HTTP/2 file-descriptor response helpers, ORIGIN/ALTSVC extensions, broader protocol error
  validation, and sustained-load validation.
- TLS session-cache and OCSP callbacks, plus broader certificate and platform coverage.
- Complete HTTP server deadline enforcement and broader backpressure/load validation.
- Restore the `nodeModules` plugin option so users can explicitly exclude packages while automatic
  placement continues to bundle every package that can consume browser runtime contracts.
- Export the plugin from the package root so `import { lumiana } from 'lumiana'` is supported while
  `lumiana/client` remains the browser entry.
- UDP, full worker-thread semantics, complete async-context propagation, and process lifecycle.
- Complete VM context semantics, V8 introspection, broader child-process parity, and broader real
  native-addon fixtures.
- Cross-machine deployment behavior and Windows filesystem/network behavior need their own
  validation environments.
- A general compiler transaction model that can lift synchronous-looking source into asynchronous
  WebSocket operations where program semantics permit it.
