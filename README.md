# Lumiana

Use Node.js 22.18+ on the 22.x line, or Node.js 24.11+. It connects a Vite application to a Node.js Worker through native handler references. Application code keeps normal imports, synchronous methods, constructors, property access, and callbacks. Browser code can use the DOM alongside those references.

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

`hostname()` runs on the server and returns a string synchronously. The DOM update runs in the browser.

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

`nodeModules` explicitly excludes matching packages from the browser bundle. Other packages are bundled when their browser entry can be bundled. Importing a Node built-in is not a reason to exclude a package: its built-in imports become native references while its JavaScript remains in the browser. Native addons, dynamic native resolution, and module-relative native runtime requirements provide evidence for exclusion. Browser export conditions are respected. There is no third-party library allowlist. The maintained `events` and `buffer` browser implementations execute locally; other pure application and bundled package functions also stay local.

Unqualified `fetch` and `WebSocket` use hybrid routing. Same-origin URLs execute in the browser; other origins use native networking. Relative URLs resolve against the page. WebSocket origin comparison pairs `ws:` with `http:` and `wss:` with `https:`. Explicit `window.fetch` and `window.WebSocket` retain their browser implementations. Imported native handlers retain their own implementation. The transform respects lexical bindings, so locally defined functions with these names are untouched.

Primitives and plain records cross by value, including cyclic records. Functions, arrays, class instances, symbols, and other native objects retain references to their owner. Passing a reference back restores its original value and identity. Binary buffers and typed arrays cross as bytes. Promise settlement is mirrored into a local Promise while retaining its native reference identity for return trips. References live until the session ends.

Synchronous operations use synchronous XHR. The request is MessagePack binary; the response is MessagePack encoded as Base64 text, with gzip for larger responses. The browser decompresses it before decoding. Asynchronous traffic uses binary MessagePack WebSocket messages. Native callbacks can reenter browser code, including nested synchronous calls back to native handlers. Native queued work is held until the caller finishes its synchronous turn, so registering a listener immediately after creating a native resource is ordered correctly.

Consecutive property reads are combined when they can execute on the same owner. For example, `process.env.HOME` takes one synchronous request. This also applies to other globals, module references, and references passed into ordinary functions. Reads remain live; values are not cached. Evaluation continues locally at copied values, and computed expressions, method receivers, and assignment targets keep their original evaluation order.

Each connection owns one Worker. Closing the connection stops the Worker; Worker exit or failure closes the connection and rejects pending work. Credentials are checked at initial establishment. Subsequent messages route to that connection's Worker without module allowlists or per-operation permission checks. Worker console output, standard output/error, and uncaught errors are projected into the browser.

Run `vite build` followed by `vite preview` to try the built application locally, including its native Node.js handlers. Preview uses the plugin's credentials and respects Vite's base path and preview options.

`vite build` creates `dist/public`, the shared host and Worker runtime in `dist/server`, a deployment `package.json`, and `dist/main.mjs`. For standalone deployment, run `bun install --production` and `bun run start` in `dist`. `LUMIANA_PORT` and `LUMIANA_HOST` configure the standalone listener (defaults: `3883` and `127.0.0.1`). Vite dev and preview use Vite's port and host options. Vite controls application minification through its normal `build.minify` option.

A remote reference remains a JavaScript proxy. Owner methods and constructors preserve native receivers, but a browser intrinsic that directly inspects private engine state—such as `Map.prototype.get.call(remoteMap)`—cannot acquire another process's internal slots. Use `remoteMap.get(key)` to invoke its native handler. Synchronous module loading also retains Node's restriction on modules with top-level asynchronous initialization; use asynchronous `import()` for those modules. Lumiana does not claim to erase these engine constraints or network latency.

Run `bun run typecheck` and `bun run test` for the automated suite. The original mixed Node/DOM watcher lives in `example`. Independent browser checks run with `bunx vite --config test/browser/vite.config.ts` and report their result on the page. The playground has its own dependencies; run `bun install` inside `playground` before using its scripts.
