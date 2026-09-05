# Project memory

The user designated `agent/` as the assistant's project memory on 2026-09-05.
Read this file when resuming work. Keep durable decisions, relevant findings,
and remaining work here or in linked files in this directory. Update stale
information and verify implementation details against the source. Never store
credentials or secrets here.

## Working agreements

- Use Bun 1.3.14 for package management and scripts (`bun install`, `bun run
test`), with separate text `bun.lock` files for root, example, and playground.
  Node.js remains the execution runtime; use `bun run test`, not `bun test`.
- The example consumes this checkout through `lumiana: "link:lumiana"`.
  Build the root and run `bun link` there before installing example dependencies.
  Bun's `link:` protocol uses its global registry; `link:..` is not a relative
  symlink. `file:..` recursively copies the parent tree, so do not use it here.
- Bun migration was verified in a fresh temporary checkout with frozen installs,
  all ten Node tests, both Vite 6/8 builds, and a package dry run. The registered
  `lumiana` link points back to this working checkout after validation.
- Keep the architecture and public API simple and clean.
- Understand underlying causes; avoid workaround-based fixes.
- Reason through domains and contracts. Consumers use contracts; a particular
  consumer must not define the shared abstraction.
- The user authorizes routine project work without repeated confirmation.
  Follow any applicable environment permission requirements.

## Current context

- The project is Lumiana, a Vite integration for browser access to native Node.js
  handlers across a remote boundary.
- The user is reviewing runtime placement and request-count optimization.
- Application runtime exports currently include `lumiana`, `connect`, `node`,
  and `Buffer` from `lumiana/client`. The Vite plugin is `lumiana` from `lumiana`.
- Static property chains now share one invocation while their intermediate
  values remain native references. `process.env.HOME` uses one XHR. This is a
  general compiler/reference optimization, not a module or property allowlist.
- Portable intrinsic expressions use copied operation graphs. The owner executes
  the graph atomically when the browser intrinsic retains its captured identity;
  replacement functions fall back to normal reference semantics with the correct
  receiver. `JSON.stringify(process.env)` now takes one synchronous request and
  does not cache or snapshot the environment.
- Static named ESM exports with local implementations are analyzed through their
  lexical binding dependencies. Implementations that transitively require native
  capabilities can execute in the Worker while independent packages remain
  bundled. Direct built-in re-exports do not move their package. In the example,
  Hono stays browser-side and `@hono/node-server`'s `serve` export runs natively;
  loading and starting it takes two synchronous requests. The deployment manifest
  includes `@hono/node-server` automatically, and an end-to-end HTTP test reaches
  the browser Hono handler.
- Static bindings from one native import now load in one synchronous request.
  Calls such as `app.get('/', callback)` combine a remote method read and apply
  when every argument is statically free of observable evaluation effects.
  Unstable arguments retain separate native reflection so getter/argument order
  remains exact. The real Express integration performs four application
  operations at startup; Express adds four callback-reflection replies because
  it inspects live browser-owned functions, for eight HTTP requests in the test.
- `node:util` is in the portable built-in domain with `node:events` and
  `node:buffer`, backed by the maintained `util` browser package. Native
  `util.inherits(Boot, EventEmitter)` mutated a copied `Boot.prototype` because
  plain records cross by value, leaving Fastify without `setMaxListeners`.
  Executing `inherits` beside its caller-owned constructors preserves prototype
  identity. A generic inheritance fixture covers this placement. A production
  Vite 8 Fastify bundle was executed through the real host/Worker transport and
  successfully served `Hello from Fastify`; its un-awaited `listen()` needed
  time to settle before the measurement request.
- Placement validates the static exports requested from a conditional browser
  entry. If that resolved file omits a requested export and the package's Node
  entry provides it, the import executes natively and the package is included in
  deployment. This is an export contract, not a package-name exception. It fixes
  `import { WebSocketServer } from 'ws'`: Vite selects `ws/browser.js`, which has
  no such export, while the Node entry provides it. A synthetic conditional
  package covers the compiler rule and the real `ws` server is constructed and
  exchanges binary data through the host/Worker integration test.
- `Invocation.path` carries reads; `Graph.path` resumes any remaining reads at
  the caller when values copy or references return home. Preserve snapshot,
  getter, error, receiver, assignment, and computed-key behavior. Do not cache
  live property values as a latency shortcut.
- `access.ts` / `lumiana/internal` is a small reader runtime with a shared weak
  ownership registry. It has no connection dependency, so local reads work before
  connection and bundled CommonJS libraries retain their original module format.
  The compiler still preserves ordinary public imports.
- Linked installations can place `access.js` and `client.js` outside Vite's root.
  The plugin adds these exact browser entries to the resolved `server.fs.allow`
  list, preserving detected workspace paths and explicit configuration. Optimized
  dependencies may request them before application import analysis grants access.
  Regression coverage checks both allow-list modes, dependent browser assets, and
  continued rejection of server runtime files. `JSON.stringify(process.env)` also
  passes through the real HTTP client test. All eleven tests and type checking
  pass; the linked Vite 8 example returns HTTP 200 for `access.js`.
- Chain and execution-placement validation: all eleven automated tests and type checking pass;
  Vite 6 and 8 example builds pass. Request-count tests use real HTTP through an
  XHR test shim and separate Workers. Additional checks cover local reads before connection,
  separately bundled readers, CommonJS strict mode, Vite metadata, and execution
  of built browser Buffer code. Changed files pass formatting.
- Connection establishment uses `await connect.credentials(...)`.
- Plugin credential options are nested under
  `defaultCredentials: { username, password }`; top-level plugin `username` and
  `password` options were removed. Client connection credentials stay flat.
- Environment credentials (`LUMIANA_USERNAME`, `LUMIANA_PASSWORD`) override
  `defaultCredentials` consistently in dev, preview, and standalone production.
  Generated deployment defaults come from plugin configuration, not build-time
  environment credentials. The standalone listener uses `LUMIANA_PORT` and
  `LUMIANA_HOST` (defaults 3883 and 127.0.0.1); Vite retains its own listener options.
- Production startup prints a readable ready message and an HTTP URL with the
  actual bound port and Vite base path. Wildcard binds use a loopback URL;
  IPv6 URL hosts are bracketed.
- Bootstrap examples should use the instance returned by
  `connect.credentials(...)`. The imported global singleton is intended for
  use inside the connected hybrid application.
- Keep introductory examples minimal and runnable without assumed files or
  elaborate setup/cleanup. The README demonstrates `hostname()` from `node:os`
  alongside a DOM update; the user found the temporary-file example too complex.
- The client singleton provides `status()` for main server status and
  `disconnect()`. Native module imports work through the plugin; `node()` is an
  optional explicit resolver.
- `vite preview` now serves the browser build from `<outDir>/public` and attaches
  the shared native host in production mode. Native modules resolve against the
  project root for local preview. Example and playground preview scripts use
  `vite preview`; standalone deployment still uses the generated `main.mjs`.
- Preview integration coverage checks default/custom output directories and base
  paths, credentials, built assets, WebSocket status, synchronous native calls,
  and shutdown. The suite also verifies chain semantics and actual request counts.
- The full formatting check currently flags the existing `example/src/entry.ts`;
  files changed for preview pass formatting. Do not reformat unrelated user code
  as part of this task.
- Proposed, but not implemented or specifically requested: move the six
  plugin-facing internal helpers out of the public client entry point.

## Next work

Do not reduce live callback-reflection requests through metadata caching; it is
observably incorrect for mutable functions and Proxies. Further reductions for
frameworks that pass large application graphs into native adapters require a
general co-location/execution-region contract, not framework-specific rewrites.
The retained native-factory placement starts the real Elysia example in 28
synchronous HTTP exchanges in the current Node 24/Vite 8 environment and serves
an actual request successfully.
An experiment kept `@elysia/node`'s record factory bundled and propagated Node
export conditions through its dependencies. It preserved the correct Node
`crossws`/`srvx` implementation but produced 211 synchronous exchanges at real
startup because low-level server classes then reflected across the boundary.
That experiment was reverted. Moving the adapter graph alone is not a valid
optimization; Elysia and its native adapter would need a shared execution region.
