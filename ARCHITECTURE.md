# Lumiana architecture

Lumiana separates JavaScript execution from host capabilities. Package JavaScript executes in the
browser. The Node.js Worker performs only operations that require its operating system or a native
addon. A package is a consumer of these contracts and never determines their shape.

| Domain        | Contract                                                                                                                         | Implementation                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Bundle        | Keep package JavaScript local, select the usable conditional export, and replace Node builtins with local runtime modules.       | `build.ts`, `vite.ts`                |
| Local runtime | Provide real browser objects, constructors, callbacks, streams, events, and module state.                                        | `browser.ts`, `runtime/*`            |
| Values        | Copy data graphs while preserving cycles and binary bytes. Reject JavaScript behavior at the boundary.                           | `values.ts`, `protocol.ts`           |
| Capabilities  | Identify connection-owned files, processes, listeners, sockets, and native-addon resources with opaque numeric handles.          | `runtime/*`, `kernel/*`              |
| Transport     | Send asynchronous commands and events over MessagePack WebSocket; send inherently synchronous commands through synchronous HTTP. | `browser.ts`, `host.ts`, `worker.ts` |
| Connection    | Authenticate once, create one Worker, and bind the browser session and Worker lifetime together.                                 | `browser.ts`, `host.ts`              |

## Ownership

An imported package, its module state, its classes, and the objects it creates belong to the
browser. Lumiana does not load that package again in the Worker and does not create a general
remote-object graph. This gives all local consumers the same identity and prototype domain.

Objects such as `Server`, `Socket`, `ChildProcess`, and `FSWatcher` are also constructed in the
browser. A private handle inside each object names the corresponding operating-system resource in
the Worker. Methods translate Node contracts into capability commands; Worker events update or
invoke the local object.

Stable host information such as `process.env` and most of `node:os` arrives as a connection
snapshot. Reading or serializing it is therefore local. Live information and mutations cross the
boundary when requested.

## Boundary values

Primitives, data-only records, arrays, dates, regular expressions, and binary views are copied.
MessagePack carries binary values as bytes. Cycles and repeated identities inside one copied graph
are preserved.

Functions, class instances, accessors, and objects with behavioral property descriptors are not
copy values. A capability contract must describe the operation that uses them. This rule prevents
the serializer from silently stripping prototypes, methods, or descriptors.

Errors cross as copied error information and are reconstructed in the receiving context. Worker
logs and fatal errors are projected into the browser.

## Native addons

Lumiana detects `.node` imports during bundling. The JavaScript package around the addon remains in
the browser. The production manifest contains only the package that owns the native binary, so the
Worker can load that binary.

The standalone production entry treats that manifest as an executable deployment contract. Before
opening the server, it checks for every recorded package under its own `node_modules` and invokes
the package manager selected by the application's lockfile only when packages are missing. Native
install scripts therefore run in the deployment environment, while an already-prepared deployment
starts without an installation step.

CommonJS addon loaders often receive only a binary basename and discover its installed path from
`__filename`. That discovery cannot run after bundling because the browser bundle is no longer in
the package's filesystem directory. When a loader call has a static `.node` request, Lumiana finds
the matching installed binary at build time, records its owning package, and replaces the locator
call with the same native-addon capability used by direct `.node` imports. This decision follows
the source shape and filesystem evidence; it does not depend on the loader's or consumer's package
name.

Some loaders compute the final binary path before passing it to a dynamic CommonJS `require`.
When the containing module has an installed `.node` target that can be established at build time,
Lumiana retains that local path computation and routes the resulting `.node` load through the
native-addon capability. Discovery prefers the requested basename; packages that compute a
platform-specific basename use the single installed binary matching the build platform and
architecture. An ambiguous set fails the build. Dynamic JavaScript-module loading remains outside
that capability.

The binary's entry points become local browser functions backed by native operation handles.
Returned data records copy normally. Returned native instances become local objects whose private
handles identify native resources. Constructors, prototypes, method receivers, repeated values,
and `instanceof` stay coherent in the browser. Browser callbacks remain browser functions; the
native operation receives a callback capability and Lumiana returns callback values across the
same connection.

This adapter is specific to the native-addon boundary. It is not a mechanism for moving ordinary
JavaScript modules or arbitrary objects into the Worker.

## Module selection

Importing a Node builtin through either `fs` or `node:fs` does not make a dependency server-owned.
Both specifier forms establish the same Node execution provenance. Lumiana resolves that builtin to
a browser runtime contract and continues bundling the dependency.

Some packages publish different browser and Node conditional exports. If the browser export lacks
an export used by the source while the Node export provides it, Lumiana bundles the Node export and
rewrites its builtin imports to local runtime contracts. Dependency source that explicitly consumes
Node behavior also resolves its own conditional dependencies with Node conditions. Application
composition modules retain normal browser conditions for unrelated imports.

The analysis follows import syntax, required exports, transitive `export *` edges, lexical bindings,
and package metadata through the active Vite resolver. It does not use package-name lists. A missing
builtin contract fails the build with the missing domain instead of moving the package into the
Worker.

Ambient names do not establish a Node contract for a dependency. Libraries routinely probe names
such as `process` and `setImmediate` to select browser behavior, and Vite owns its
`process.env.NODE_ENV` replacement. Lumiana supplies implicit Node globals to application modules
and to dependency modules with explicit Node provenance: a Node builtin import, a Node conditional
export selected by the resolver, or module-relative Node metadata. This keeps browser feature
detection intact without package-specific exceptions.

Node provenance follows the resolved dependency edges of a selected Node runtime contract. This
includes relative implementation files and helper packages used by a builtin adapter. The rule is
graph ownership: browser graphs retain browser globals, while every module executing inside a local
Node contract receives that contract consistently.

CommonJS `__filename` and `__dirname` describe module identity rather than an operating-system
operation. Lumiana records each module's path relative to the build root and resolves it locally
against the connection's module root. This root is distinct from `process.cwd()`. The values
therefore require no boundary request and remain valid when a production bundle is moved or started
from another working directory.

## Transport and lifetime

Asynchronous commands, results, callbacks, and resource events share one binary WebSocket. A
synchronous Node API makes one synchronous HTTP request for its operating-system decision. Large
synchronous replies use gzip around the required text envelope.

Native addons may invoke a browser callback before a synchronous native call returns. In that
case, the synchronous response carries the callback request, the browser executes its local
function, and a continuation returns the copied result. The Worker waits on its message port so the
native stack remains intact. This callback contract is also used by native TLS operations. SNI
selection may complete asynchronously over the WebSocket; ALPN and PSK selection remain
synchronous because the native TLS stack requires an immediate return. Asynchronous addon
callbacks use the WebSocket.

HTTP is not an engine domain. HTTP/1 parsing and response framing, HTTP/2 framing and HPACK,
stream flow control, multiplexing, and Agent scheduling execute in the browser over the socket
capability. TLS hostname matching also executes in the browser from the copied peer certificate.
The engine retains the TCP or Unix socket, native TLS state, secure contexts, and other system
resources that JavaScript cannot own locally.

Each authenticated connection owns one Worker and its resource handles. Closing the browser side,
the Worker, or the host invalidates the whole connection. Handles from a closed connection cannot
be reused by a later connection.

## Known incomplete domains

The architecture deliberately reports an unsupported local contract where behavior is not yet
implemented. Current incomplete areas include HTTP/2 file-descriptor response helpers and
ORIGIN/ALTSVC extensions, TLS session-cache and OCSP callbacks, complete HTTP server deadline
enforcement, DNS, UDP, async context, complete VM isolation and V8 introspection, advanced
filesystem descriptors and streams, and some process and child-process behavior. Worker threads
have a browser-owned compatibility contract, but their full Node semantics are not yet established.
These are runtime-domain gaps, not reasons to externalize a consumer package.
