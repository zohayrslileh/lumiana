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
- The user is reviewing the runtime API before further optimization.
- Application runtime exports currently include `lumiana`, `connect`, `node`,
  and `Buffer` from `lumiana/client`. The Vite plugin is `lumiana` from `lumiana`.
- Static property chains now share one invocation while their intermediate
  values remain native references. `process.env.HOME` uses one XHR. This is a
  general compiler/reference optimization, not a module or property allowlist.
- `Invocation.path` carries reads; `Graph.path` resumes any remaining reads at
  the caller when values copy or references return home. Preserve snapshot,
  getter, error, receiver, assignment, and computed-key behavior. Do not cache
  live property values as a latency shortcut.
- `access.ts` / `lumiana/internal` is a small reader runtime with a shared weak
  ownership registry. It has no connection dependency, so local reads work before
  connection and bundled CommonJS libraries retain their original module format.
  The compiler still preserves ordinary public imports.
- Chain optimization validation: all ten automated tests and type checking pass;
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

Await the user's next optimization instruction. Creating this memory does not
authorize an API redesign.
