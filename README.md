# Lumiana

Lumiana lets a Vite application use Node.js and the DOM together.

Application code keeps ordinary Node imports, objects, constructors, callbacks, streams, and
events. JavaScript behavior runs in the browser whenever it can. Operations that require the host
operating system are executed by a dedicated Node.js Worker and returned through the Lumiana
connection.

This means a library can retain its normal JavaScript identity in the browser while its file
handles, listening sockets, child processes, and native implementations remain on the server.

![Lumiana execution architecture](./docs/lumiana-architecture.png)

## How execution is divided

Lumiana divides behavior by capability rather than by package name:

- JavaScript values, module objects, constructors, callbacks, streams, event emitters, timers,
  hashing, compression, and stable process information stay in the browser.
- File handles, listeners, sockets, child processes, and other operating-system resources live in
  the connection's Worker.
- Asynchronous commands and events use the existing binary MessagePack WebSocket.
- Synchronous Node operations remain synchronous and cross the boundary once when they require the
  Worker.
- Operating-system resources are represented by local objects containing private capability handles.

Package JavaScript is bundled into the browser. Importing a Node builtin does not move a package to
the server because the package consumes Lumiana's browser-owned implementation of that builtin.
Only concrete operating-system commands cross the connection.

There is no package allowlist.

## Requirements

- Node.js 22.18 or newer on the 22.x line, or Node.js 24.11 or newer
- Vite 5, 6, 7, or 8

Install Lumiana in the Vite application:

```sh
npm install lumiana
```

## Basic usage

Add the plugin to `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { lumiana } from 'lumiana/vite';

export default defineConfig({
  plugins: [lumiana()],
});
```

Establish the connection before loading application modules that use Node capabilities:

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

The application itself uses normal imports:

```ts
// app.ts
import { hostname, platform } from 'node:os';

document.body.textContent = `Connected to ${hostname()} on ${platform()}`;
```

`hostname()` and `platform()` use the stable operating-system snapshot received during connection,
so this example updates the DOM without another network request.

ES module imports execute before the importing module body. The dynamic import in `main.ts`
therefore guarantees that the connection exists before `app.ts` runs. The application does not
need a special filename or directory.

## Client API

Import the browser API from `lumiana/client`:

```ts
import { lumiana, connect } from 'lumiana/client';
```

### `await connect.credentials(credentials)`

Establishes the single Lumiana connection for the browser context and returns the existing
`lumiana` instance.

```ts
const instance = await connect.credentials({
  username: 'lumiana',
  password: 'lumiana',
});
```

- The instance exists before connection, but interacting with it before connection throws.
- Repeating the same connected call returns the same instance.
- A concurrent connection attempt throws.
- Attempting a different connection while one is active throws.
- After disconnection, the same instance can connect again.

### `await lumiana.status()`

Returns the main server status and the measured connection latency:

```ts
const status = await lumiana.status();

console.log(status.mode);
console.log(status.version);
console.log(status.connections);
console.log(status.latency);
```

The result contains the server PID, uptime, mode, Node version, platform, memory usage, active
connection count, server time, and latency.

### `lumiana.disconnect()`

Closes the connection, stops its dedicated Worker, rejects pending operations, and invalidates
host resource handles. If the Worker stops first, the browser connection closes as well.

## Plugin configuration

```ts
import { lumiana } from 'lumiana/vite';

lumiana({
  defaultCredentials: {
    username: 'my-user',
    password: 'my-password',
  },
});
```

### `defaultCredentials`

Defines the credentials used by the development server, Vite preview, and standalone production.
The defaults are `lumiana` / `lumiana`.

Environment variables take precedence:

- `LUMIANA_USERNAME`
- `LUMIANA_PASSWORD`

Credentials protect initial connection establishment. After authentication, messages route
directly to that connection's Worker without per-operation allowlists.

Lumiana owns dependency placement. Package JavaScript stays in the browser bundle. Node export
conditions are selected when a dependency requires them, while operating-system and native-addon
operations use runtime capability contracts.

Native `.node` imports are detected automatically. The package's JavaScript remains in the browser,
and Lumiana includes the package that owns the binary in the production server. Native functions,
instances, prototypes, and callbacks have local browser objects backed by private connection
handles.

## Hybrid browser APIs

Unqualified `fetch` and `WebSocket` use hybrid routing:

- Same-origin requests execute in the browser.
- Requests to another origin execute through native networking.
- Relative URLs resolve against the page.
- `ws:` is compared with `http:`, and `wss:` with `https:`.

Explicit `window.fetch` and `window.WebSocket` always retain their browser implementations.
Functions imported from a Node library retain that library's implementation. Locally declared
bindings named `fetch` or `WebSocket` are not transformed.

## Values and capabilities

JavaScript objects, functions, classes, callbacks, streams, and events stay in the browser. Values
that form an operating-system command are copied across the boundary. This includes primitives,
plain records, arrays, dates, regular expressions, binary views, and cyclic structures.

Local runtime objects keep private numeric handles for files, sockets, processes, and listeners.
The handles identify operating-system resources; they are never exposed as JavaScript proxies.
Server logs, standard output, standard error, and uncaught errors are projected into the browser
console.

## Node runtime support

Lumiana currently provides browser-owned contracts for:

- `node:fs`, including callback, Promise, synchronous, stream, and watcher forms
- `node:net`, including TCP and Unix sockets
- the server half of `node:http`
- `node:child_process`, including local streams and lifecycle events
- `node:os` and local stable system information
- `node:crypto` and `node:zlib`
- `node:module`, including source-relative `createRequire()`
- `node:stream/promises`
- `node:timers`
- `node:url` and `node:util`
- portable modules such as `assert`, `buffer`, `events`, `path`, `querystring`,
  `string_decoder`, and streams

Child processes, file watchers, connections, and listeners expose browser-owned objects while the
Worker keeps their operating-system handles. `process.env`, `homedir()`, and `platform()` are local
connection snapshots and make no request when read or serialized.

`node:tty`, `node:perf_hooks`, `node:v8`, and `node:vm` provide their currently supported local
behavior. `node:https`, `node:http2`, and `node:tls` currently report a clear unsupported runtime
contract when an operational method is called.

Static missing optional dependencies are recorded during the build. A local `createRequire()` then
throws `MODULE_NOT_FOUND` without contacting the server, allowing the package's own fallback logic
to run normally.

## Running and deployment

Run the Vite application normally during development:

```sh
npm run dev
```

Preview the production build with Vite:

```sh
npm run build
npm run preview
```

`vite build` creates:

```text
dist/
├── client/       browser application
├── server/       Lumiana host and Worker runtime
├── main.mjs      standalone entry
└── package.json  production dependencies and start command
```

For a standalone deployment:

```sh
cd dist
bun install --production
bun run start
```

The standalone server uses `LUMIANA_HOST` and `LUMIANA_PORT`, defaulting to `127.0.0.1` and `3883`.
Vite development and preview continue to use Vite's normal host and port configuration. Vite also
controls application minification through `build.minify`.

## Runtime constraints

Network latency still exists when an operation crosses the boundary. Synchronous operating-system
commands use synchronous XHR with MessagePack data. Asynchronous commands and events use the
binary WebSocket.

Runtime-selected package names cannot be added to a browser bundle after it has been built, so a
dynamic `require(name)` outside the statically included graph throws `MODULE_NOT_FOUND` locally.
`vm.runInThisContext()` evaluates in the browser global realm; separate Node VM context semantics
remain incomplete.

These are consequences of the process and network boundary. Lumiana reports a missing local
runtime contract instead of silently moving a library into the Worker.

## Repository development

This section is for contributors working on Lumiana itself.

The repository uses Bun for package management and Node.js for runtime execution:

```sh
bun install
bun run build
bun run typecheck
bun run test
```

To run the linked vanilla example from this checkout:

```sh
bun link
cd examples/vanilla
bun install
bun run dev
```

The playground has separate dependencies. Run `bun install` inside `playground` before using its
scripts.
