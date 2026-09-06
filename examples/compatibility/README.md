# Compatibility examples

Each file in `src/cases` imports the original library, uses the DOM for its result,
and asserts observable behavior. The same code is both an example and a browser
regression test. No package-specific Vite configuration is required.

From the repository root:

```sh
bun install
bun run build
bun link
cd examples/compatibility
bun install
bun run dev
```

Open http://127.0.0.1:5190 and select **Run all examples**. Initial dependency
optimization can reload the page before the controls become ready. Runs execute
sequentially; individual examples can also be run again. Each run creates its own
temporary resources and closes or removes them in `finally`.

For Vite's production preview:

```sh
bun run build
bun run preview
```

Open http://127.0.0.1:5191 and run the same checks. The credentials are the default
`lumiana` / `lumiana`.

For the standalone production server, run these commands from
`examples/compatibility`:

```sh
bun run build
bun install --production --cwd dist
node dist/main.mjs
```

Open http://127.0.0.1:3883 and run the same checks. The standalone build declares
native package dependencies in `dist/package.json`; install them after building.
Vite preview uses the example's dependency installation, while the standalone
server uses `dist/node_modules`, regardless of the directory it is launched from.
SQLite requires a native binary compatible with the server's Node version and
platform.

| Example          | Assertions                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ws`             | Two clients, Unicode and binary broadcasts, compression, ping/pong, close codes, same-port restart, callback counts |
| `agent`          | HTTP and HTTPS requests queue and reuse one socket with browser-owned scheduling                                    |
| `http2`          | Four concurrent binary streams over one verified TLS session, flow control, HPACK, and ping                         |
| `tls-callbacks`  | Asynchronous SNI, synchronous ALPN and PSK, binary keys, accepting socket identity                                  |
| `archiver`       | Real file → ZIP → independently inflated exact content                                                              |
| `better-sqlite3` | Native addon, prepared statements, Unicode, binary BLOBs, commit and rollback                                       |
| `node-sqlite`    | Built-in SQLite, browser callbacks and tag cache, prepared statements, binary BLOBs                                 |
| `chokidar`       | Native filesystem add/change/unlink events, no events after closing                                                 |
| `cross-spawn`    | Real Node child, exact stdout/stderr, exit code                                                                     |
| `csv-parse`      | Real file stream with three-byte chunks, split Unicode and quoted newlines                                          |
| `express`        | Routing, JSON middleware, actual HTTP POST, request/response event ordering                                         |
| `fast-glob`      | Synchronous and asynchronous directory scans agree                                                                  |
| `https`          | Verified HTTPS streaming, original ws over WSS, compression, binary data, socket constructor identity, clean close  |
| `tls`            | Existing TCP socket upgrade, certificate and hostname verification, ALPN, binary echo, socket constructor identity  |
| `semver`         | Pure local version selection and increment                                                                          |
| `tar`            | File → gzip TAR → extracted exact content                                                                           |
| `yaml`           | Pure local Unicode serialization and parsing                                                                        |

The networking cases bind temporary loopback ports. The TLS fixture contains public
test credentials for localhost; it is not a deployment certificate. These tests do not require an
external service or a database installation.

## Runtime findings

The examples exercise shared contracts, not adapters for these packages:

- HTTP clients and servers parse and frame messages locally over the byte-stream transport;
  HTTP upgrades hand the same socket and unconsumed bytes to the consumer.
- TLS handshakes and encryption use native Node sockets. The browser retains stream
  ownership, hostname matching, and SNI/ALPN/PSK callbacks; negotiated metadata is available locally.
- HTTP/2 owns framing, header compression, flow control, and multiplexed streams locally.
- HTTP/HTTPS Agents own socket reuse and request queues locally.
- HTTPS shares HTTP framing and lifecycle handling, including secure WebSocket upgrades.
- Corked socket writes become one kernel write. Headers and the first request
  body chunk are sent together; empty writes make no request.
- Local streams own `end` and `finish` ordering. A transport `close` cannot
  overtake buffered readable data or duplicate writable completion.
- Filesystem reads update the caller's buffer and preserve its identity. Binary
  content, offsets, and vector reads survive serialization.
- Both POSIX and Windows path parsing run locally. Relative resolution uses the
  connected process's working directory.
- Computed native addon filenames retain their runtime selection. JavaScript
  wrappers remain bundled; the addon owner is included in server dependencies.
- Built-in SQLite keeps native database, statement, iterator, and session handles
  in the engine. API objects, tagged-statement caching, and user callbacks remain in the browser.
- Runtime implementation dependencies use browser export conditions. Node
  consumers retain Node resolution where their imports require it. Missing
  optional CommonJS dependencies throw at the original call so the package's own
  fallback can run.

Focused regression tests for these contracts are in `test/`. Run `bun run test`
from the repository root. The browser examples are currently run through this UI,
not automatically by that command.

## Scope

Passing these scenarios is evidence for the exercised behaviors, not a claim that
every API of each package is supported. HTTP/2 file-descriptor response helpers and
ORIGIN/ALTSVC extension APIs, TLS session-cache and OCSP callbacks, and comprehensive
HTTP server deadline enforcement remain incomplete. Tests use local loopback networking;
deployment across machines, Windows filesystem operations, and sustained-load behavior
still need separate validation.
