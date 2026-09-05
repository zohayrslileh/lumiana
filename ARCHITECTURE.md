# Lumiana architecture

The implementation separates contracts from the libraries that consume them. A watcher, stream, HTTP server, class instance, or callback is a value handled by the reference contract; none defines that contract.

| Domain           | Contract                                                                                                                                                       | Implementation             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Module placement | Preserve browser bundling unless explicit configuration or build evidence requires native execution. Preserve resolution origin and browser export conditions. | `build.ts`, `index.ts`     |
| Values           | Copy primitive values and plain record graphs; retain other identities; carry binary data as bytes.                                                            | `values.ts`, `protocol.ts` |
| References       | Reflect operations against the original owner, including receivers, constructors, symbols, descriptors, and integrity operations.                              | `references.ts`            |
| Browser context  | One inactive/active singleton and at most one connection establishment.                                                                                        | `client.ts`                |
| Connection       | Bind all traffic to one Worker and link their lifetimes. Authenticate once at establishment.                                                                   | `host.ts`                  |
| Native execution | Execute handlers, preserve synchronous callback returns, and mirror promise settlement.                                                                        | `worker.ts`                |

The dependency direction is explicit: Vite resolves and transforms imports; the client and Worker consume the same reference and value contracts; the host routes messages without interpreting particular libraries or methods. Development and production use the same host and Worker files.

A synchronous call sends a binary MessagePack invocation over XHR. Its result returns through a gzip-compressed Base64 envelope when sufficiently large. If native execution invokes a browser callback, the HTTP response carries that callback instead. The browser executes it, then supplies its result through a continuation request. Nested calls use distinct request identities. The Worker waits with `Atomics.wait` and drains its message port, so these nested operations can execute while the original native stack remains intact.

The caller owns a synchronous turn. A queued browser microtask releases it after the synchronous stack completes. Until that release, the Worker processes further invocations without advancing its native event loop. A callback wait is already a reentrant pump and does not add another turn hold. This is what preserves listener registration order without event replay or special treatment for readiness events.

Promises return immediately as references. Export observes the original rejection immediately; import subscribes to settlement and creates the local Promise. This transfers rejection reporting to the receiving runtime before transport latency could cause a premature unhandled rejection in the owner. The asynchronous transport carries settlement as binary MessagePack.

A reference returning to its owner decodes to the original object. Each session caches exported and imported identities, so listener removal, method receivers, and repeated returns use the same objects. Disconnect clears those stores. Proxy targets distinguish callable, constructible, array, and object values. Descriptor mirroring satisfies JavaScript's non-configurable and non-extensible proxy invariants.

An invocation can carry a path of property reads. The owner executes consecutive reads while their intermediate results remain owned references. At a copied value or a reference returning to the caller, the response carries the remaining path for local evaluation. This preserves record snapshots, primitive and binary behavior, getters, errors, and reference identity without caching property values. Native callbacks still use the existing continuation protocol.

The compiler combines static member reads through a small ownership-aware reader in `access.ts`. Its weak registry lets separately bundled copies find the same proxy reader, including after reconnect when old references must still throw. Local values need no connection. The `lumiana/internal` entry has no dependency on the connection or serialization runtime, and its imports preserve ESM or CommonJS syntax. Globals and synchronous module resolution can carry their read path in the initial invocation. Dynamic keys, optional chains, method receivers, assignment targets, and `super` retain the JavaScript evaluation steps that cannot safely be combined.

Plain records are snapshots, not shared memory. Exotic objects such as `arguments` are references even when their prototype resembles a plain object. Copying `arguments` as a record would drop its non-enumerable `length` and silently discard arguments in native callback adapters. Prototype classification also precedes tag access to avoid reentering an inherited remote getter while serializing its receiver.

Module placement probes resolve the browser entry without loading it through Rollup's CommonJS transformer. Built-ins are external to that probe but do not make their importing package external. Native addon loading, dynamic native resolution, module-relative native globals, and failed browser bundling provide exclusion evidence. Export inspection uses syntax and module lexers, never execution of third-party packages. The deployment manifest records native packages and the package owners needed for their relative resolution.

The test suite covers independent reflection, callback, stream, binary, networking, bundling, framing, isolation, and lifetime contracts. Browser fixtures exercise the real synchronous XHR path. A passing fixture demonstrates its tested behavior; it is not proof that every possible native engine brand check or arbitrary third-party package is transparent across processes.
