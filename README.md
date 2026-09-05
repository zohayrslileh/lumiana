# Lumiana

Use Node.js 22.18+ on the 22.x line, or Node.js 24.11+. Lumiana provides a browser-owned Node.js runtime backed by a dedicated server Worker. Application code keeps normal imports, constructors, methods, callbacks, and DOM access. JavaScript behavior executes locally; filesystem handles, listeners, sockets, and other operating-system capabilities cross the connection.

This repository uses Bun for package management and Node.js for execution:

```sh
bun install
bun run build
bun run test
```

To run the example after building the library, register the checkout with [bun link](https://bun.sh/docs/pm/cli/link):

```sh
bun link
cd example
bun install
bun run dev
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { lumiana } from 'lumiana';

export default defineConfig({
  plugins: [lumiana()],
});
```

```ts
// main.ts
import { connect } from 'lumiana/client';

const lumiana = await connect.credentials({
  username: 'lumiana',
  password: 'lumiana',
});

await import('./app');
console.log(await lumiana.status());
```

```ts
// app.ts — an ordinary application module
import { hostname } from 'node:os';

document.body.textContent = `Connected to ${hostname()}`;
```

The connection snapshots stable operating-system identity, so `hostname()` and the DOM update both run locally. Live or mutating operating-system queries still cross once because their Node API is synchronous.

The bootstrap uses the instance returned by `connect.credentials()`. Inside the hybrid application, modules can import `{ lumiana }` from `'lumiana/client'` to access that same instance.

ES module imports execute before the importing module's body. Initialize the connection before loading code that interacts with native handlers. The dynamic import above establishes that order; no special file suffix or source directory is required. Top-level `await` requires a compatible Vite build target, or it can be placed inside an async bootstrap function.

The browser API is small:

| API                                                       | Contract                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lumiana`                                                 | One instance per browser context, created when the client loads. Access before connection throws.                                                       |
| `await connect.credentials({ username, password, url? })` | Activates and returns that instance. Repeating the same credentials returns it again. Concurrent establishment or a different active connection throws. |
| `await lumiana.status()`                                  | Main server PID, uptime, mode, Node version, platform, memory, connection count, server time, and measured latency.                                     |
| `lumiana.disconnect()`                                    | Closes the connection, terminates its Worker, and invalidates its references. The instance can be connected again.                                      |
| `node(specifier)`                                         | Resolves a native module through the connected Worker's Node resolver. Callable from any application module; throws before connection.                  |

```ts
// Inside the connected hybrid application
import { node } from 'lumiana/client';
import { tmpdir } from 'node:os';

const fs = node<typeof import('node:fs')>('node:fs');
const exists = fs.existsSync(tmpdir()); // boolean, synchronously
```

`url` selects the host's HTTP(S) origin; otherwise the page's origin is used. The plugin respects Vite's base path. `LUMIANA_USERNAME` and `LUMIANA_PASSWORD` override the plugin's `defaultCredentials` in development, preview, and standalone production. Unspecified credentials fall back to `lumiana` / `lumiana`.

```ts
lumiana({
  defaultCredentials: {
    username: 'my-user',
    password: 'my-password',
  },
  nodeModules: ['a-package', /^@my-company\/native-/],
});
```

`nodeModules` explicitly excludes matching packages from the browser bundle. Every other package is bundled unless resolution or build analysis proves that it cannot be bundled. A Node built-in import is not evidence for excluding its package: the package JavaScript remains local and consumes Lumiana's runtime contract for that builtin. Native addons and genuinely native implementations remain server-owned. Dependency modules that explicitly consume Node execution resolve their own dependencies with Node export conditions, while application composition modules retain browser conditions for unrelated imports. There is no third-party package allowlist.

Unqualified `fetch` and `WebSocket` use hybrid routing. Same-origin URLs execute in the browser; other origins use native networking. Relative URLs resolve against the page. WebSocket origin comparison pairs `ws:` with `http:` and `wss:` with `https:`. Explicit `window.fetch` and `window.WebSocket` retain their browser implementations. Imported native handlers retain their own implementation. The transform respects lexical bindings, so locally defined functions with these names are untouched.

Primitives and plain records cross by value, including cyclic records. Functions, arrays, class instances, symbols, and other native objects retain references to their owner. Passing a reference back restores its original value and identity. Binary buffers and typed arrays cross as bytes. Promise settlement is mirrored into a local Promise while retaining its native reference identity for return trips. References live until the session ends.

Lumiana's runtime is divided by capability. Ordinary JavaScript values, module objects, constructors, streams, events, callbacks, timers, hashing, compression, and process snapshots stay in the browser. The Worker owns only resources that require its operating system, such as file handles and listening sockets. Local objects send compact kernel commands over the binary MessagePack WebSocket when they need those resources; events return over the same connection. This preserves local identity and avoids reflection traffic through remote proxies.

The current browser-owned runtime includes callback, Promise, synchronous, stream, and watcher forms of `node:fs`; `node:net`; the server half of `node:http`; `node:child_process`; `node:os`; `node:crypto`; `node:zlib`; `node:stream/promises`; `node:module`; `node:timers`; and the portable core modules. Child processes, file watchers, TCP connections, and Unix sockets expose local event emitters and streams while their operating-system handles remain in the Worker. Their asynchronous commands and events use WebSocket. Synchronous filesystem and child-process calls use one synchronous request per operation.

`process.env` and stable OS information are initialized during connection as ordinary local values, so property access, `JSON.stringify(process.env)`, `homedir()`, and `platform()` make no requests. Runtime facades for `node:tty`, `node:perf_hooks`, `node:v8`, and `node:vm` also keep module acquisition local; operations that require Node remain native. The browser implementation of `vm.runInThisContext()` evaluates in the browser global realm. Separate Node VM context semantics do not exist in that realm and remain an incomplete runtime domain.

`createRequire()` is source-relative and local for supported builtins. When a static optional dependency is absent, the build records that fact and `require()` throws `MODULE_NOT_FOUND` locally, preserving the library's own fallback path without contacting the server.

Unsupported native modules still use references owned by the Worker. A synchronous operation on such a reference uses synchronous XHR with a MessagePack request and a compressed Base64 MessagePack response; asynchronous reference and kernel traffic uses binary MessagePack over WebSocket. This path preserves behavior while additional runtime domains move local. Lumiana does not cache mutable reflection or invent package-specific shortcuts to hide its cost.

Each connection owns one Worker. Closing the connection stops the Worker; Worker exit or failure closes the connection and rejects pending work. Credentials are checked at initial establishment. Subsequent messages route to that connection's Worker without module allowlists or per-operation permission checks. Worker console output, standard output/error, and uncaught errors are projected into the browser.

Run `vite build` followed by `vite preview` to try the built application locally, including its native Node.js handlers. Preview uses the plugin's credentials and respects Vite's base path and preview options.

`vite build` creates `dist/public`, the shared host and Worker runtime in `dist/server`, a deployment `package.json`, and `dist/main.mjs`. For standalone deployment, run `bun install --production` and `bun run start` in `dist`. `LUMIANA_PORT` and `LUMIANA_HOST` configure the standalone listener (defaults: `3883` and `127.0.0.1`). Vite dev and preview use Vite's port and host options. Vite controls application minification through its normal `build.minify` option.

A remote reference remains a JavaScript proxy. Owner methods and constructors preserve native receivers, but a browser intrinsic that directly inspects private engine state—such as `Map.prototype.get.call(remoteMap)`—cannot acquire another process's internal slots. Use `remoteMap.get(key)` to invoke its native handler. Synchronous module loading also retains Node's restriction on modules with top-level asynchronous initialization; use asynchronous `import()` for those modules. Lumiana does not claim to erase these engine constraints or network latency.

Run `bun run typecheck` and `bun run test` for the automated suite. The original mixed Node/DOM watcher lives in `example`. Independent browser checks run with `bunx vite --config test/browser/vite.config.ts` and report their result on the page. The playground has its own dependencies; run `bun install` inside `playground` before using its scripts.
