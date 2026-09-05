# Project memory

The user designated `agent/` as the assistant's project memory on 2026-09-05.
Read this file when resuming work. Keep durable decisions, relevant findings,
and remaining work here or in linked files in this directory. Update stale
information and verify implementation details against the source. Never store
credentials or secrets here.

## Working agreements

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
- Connection establishment uses `await connect.credentials(...)`.
- Plugin credential options are nested under
  `defaultCredentials: { username, password }`; top-level plugin `username` and
  `password` options were removed. Client connection credentials stay flat.
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
  and shutdown. All eight tests and both Vite 6/8 example builds pass.
- The full formatting check currently flags the existing `example/src/entry.ts`;
  files changed for preview pass formatting. Do not reformat unrelated user code
  as part of this task.
- Proposed, but not implemented or specifically requested: move the six
  plugin-facing internal helpers out of the public client entry point.

## Next work

Await the user's next optimization instruction. Creating this memory does not
authorize an API redesign.
