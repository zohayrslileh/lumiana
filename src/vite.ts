import type { Plugin, ResolvedConfig, UserConfig } from 'vite';
import { normalizePath } from 'vite';
import fs from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin, createRequire } from 'node:module';
import { resolve as resolveImport } from 'import-meta-resolve';
import { attachHost } from './host.js';
import {
  NativeAddons,
  bare,
  transformSource,
  moduleExportNames,
  nodeExportNames,
  requiresNodeResolution,
  type Placement,
} from './build.js';
export interface LumianaPluginOptions {
  defaultCredentials?: {
    username?: string;
    password?: string;
  };
}
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(import.meta.url);
// Vite's optimized dependency cache includes optimizer plugin names, but not their
// implementation. Bind cached output to every Lumiana JavaScript module that can be
// folded into it, including the browser-side built-in implementations.
const implementationHash = createHash('sha256');
const fingerprint = (directory: string) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) fingerprint(file);
    else if (entry.name.endsWith('.js'))
      implementationHash.update(path.relative(runtimeDir, file)).update(readFileSync(file));
  }
};
fingerprint(runtimeDir);
const optimizerPluginName = `lumiana-dependencies:${implementationHash.digest('hex').slice(0, 12)}`;
const clientId = '\0lumiana:client';
const runtimeId = '\0lumiana:runtime';
const runtimeSpecifier = 'lumiana/runtime';
const addonPrefix = '\0lumiana:addon:';
const commonJSBuiltinPrefix = '\0lumiana:commonjs-builtin:';
const localBuiltins: Record<string, string> = Object.assign(Object.create(null), {
  events: 'events/',
  buffer: 'buffer/',
  assert: 'assert/',
  querystring: 'querystring-es3',
  stream: 'stream-browserify',
  string_decoder: 'string_decoder/',
});
const runtimeBuiltins: Record<string, string> = Object.assign(Object.create(null), {
  path: 'runtime/path.js',
  'assert/strict': 'runtime/assert-strict.js',
  async_hooks: 'runtime/async-hooks.js',
  child_process: 'runtime/child-process.js',
  constants: 'runtime/constants.js',
  dns: 'runtime/dns.js',
  'dns/promises': 'runtime/dns.js',
  fs: 'runtime/fs.js',
  'fs/promises': 'runtime/fs-promises.js',
  http: 'runtime/http.js',
  http2: 'runtime/http2.js',
  https: 'runtime/https.js',
  module: 'runtime/module.js',
  net: 'runtime/net.js',
  os: 'runtime/os.js',
  perf_hooks: 'runtime/perf-hooks.js',
  process: 'runtime/process.js',
  readline: 'runtime/readline.js',
  'readline/promises': 'runtime/readline.js',
  sqlite: 'runtime/sqlite.js',
  'stream/promises': 'runtime/stream-promises.js',
  timers: 'runtime/timers.js',
  tls: 'runtime/tls.js',
  tty: 'runtime/tty.js',
  url: 'runtime/url.js',
  util: 'runtime/util.js',
  v8: 'runtime/v8.js',
  vm: 'runtime/vm.js',
  worker_threads: 'runtime/worker-threads.js',
  crypto: 'runtime/crypto.js',
  zlib: 'runtime/zlib.js',
});
const builtinName = (id: string) => id.replace(/^node:/, '');
const exact = (id: string) => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
export function lumiana(options: LumianaPluginOptions = {}): Plugin {
  let resolveBrowser: ReturnType<ResolvedConfig['createResolver']>;
  let resolveNode: ReturnType<ResolvedConfig['createResolver']>;
  let requireBrowser: ReturnType<ResolvedConfig['createResolver']>;
  let requireNode: ReturnType<ResolvedConfig['createResolver']>;
  let config: ResolvedConfig,
    addons: NativeAddons,
    deploymentDir: string,
    projectRoot: string,
    failed = false;
  const execution = new Map<string, Promise<boolean>>();
  const nodeFiles = new Set<string>();
  const implementationFiles = new Set<string>();
  let devServer: any;
  const implementation = (id?: string) =>
    !!id && (id.startsWith(runtimeDir + '/') || implementationFiles.has(id.split('?')[0]!));
  const implementationDependency = (file: string) => {
    implementationFiles.add(file.split('?')[0]!);
    return file;
  };
  const serveDependency = (file: string) => {
    const optimizer = devServer?.environments?.client?.depsOptimizer ?? devServer?._depsOptimizer;
    if (optimizer && file.includes('/node_modules/') && !file.startsWith('\0'))
      return optimizer.getOptimizedDepId(optimizer.registerMissingImport(file, file));
    return file;
  };
  const nodeContract = (file: string) => {
    nodeFiles.add(file.split('?')[0]!);
    return file;
  };
  let placeModule: (
    id: string,
    importer?: string,
    resolve?: (id: string, importer?: string) => Promise<string | undefined>,
    requiredExports?: string[],
  ) => Promise<Placement>;
  const defaultCredentials = {
    username: options.defaultCredentials?.username ?? 'lumiana',
    password: options.defaultCredentials?.password ?? 'lumiana',
  };
  const credentials = () => ({
    username: process.env.LUMIANA_USERNAME ?? defaultCredentials.username,
    password: process.env.LUMIANA_PASSWORD ?? defaultCredentials.password,
  });
  const base = () => new URL(config.base || '/', 'http://lumiana.invalid/').pathname;
  const prefix = () => `${base()}__lumiana/`;
  const sourceOrigin = (importer?: string) =>
    importer && path.isAbsolute(importer)
      ? path.relative(projectRoot, importer.split('?')[0]!)
      : undefined;
  const addonId = (specifier: string, importer?: string) =>
    addonPrefix + JSON.stringify({ specifier, origin: sourceOrigin(importer) });
  const addonTarget = (id: string): { specifier: string; origin?: string } =>
    JSON.parse(id.slice(addonPrefix.length));
  const commonJSBuiltinId = (file: string) => commonJSBuiltinPrefix + JSON.stringify(file);
  const commonJSBuiltinTarget = (id: string): string =>
    JSON.parse(id.slice(commonJSBuiltinPrefix.length));
  const commonJSBuiltinSource = (file: string) =>
    `import value from ${JSON.stringify(file)};module.exports=value;`;
  const skip = (id: string) =>
    id.startsWith(runtimeDir + '/') ||
    id.startsWith('\0') ||
    id.includes('/vite/dist/') ||
    id.includes('/@vite/');
  const dependencyModule = (id: string) => {
    const relative = path.relative(addons.root, id.split('?')[0]!);
    return (
      relative.startsWith('..' + path.sep) || relative.split(path.sep).includes('node_modules')
    );
  };
  const usesNodeEnvironment = (id?: string) => {
    if (!id || id.startsWith('\0') || implementation(id)) return Promise.resolve(false);
    const file = id.split('?')[0]!;
    // Application modules are composition roots: one Node import must not alter
    // the export conditions of their unrelated package imports. A dependency's
    // implementation, however, defines the environment for its own imports.
    if (!dependencyModule(file)) return Promise.resolve(false);
    if (nodeFiles.has(file)) return Promise.resolve(true);
    let pending = execution.get(file);
    if (!pending) {
      pending = fs
        .readFile(file, 'utf8')
        .then(requiresNodeResolution)
        .catch(() => false);
      execution.set(file, pending);
    }
    return pending;
  };
  const moduleResolver = async (importer?: string, require = false) =>
    (await usesNodeEnvironment(importer))
      ? require
        ? requireNode
        : resolveNode
      : require
        ? requireBrowser
        : resolveBrowser;
  return {
    name: 'lumiana',
    enforce: 'pre',
    config(user, env) {
      const root = path.resolve(user.root ?? process.cwd());
      projectRoot = root;
      addons = new NativeAddons(root);
      deploymentDir = path.resolve(root, user.build?.outDir ?? 'dist');
      const require = createRequire(path.join(root, 'package.json'));
      const localAliases = Object.entries(localBuiltins).flatMap(([id, target]) => {
        const replacement = implementationDependency(runtimeRequire.resolve(target));
        return [
          { find: exact(id), replacement },
          { find: exact(`node:${id}`), replacement },
        ];
      });
      for (const target of Object.values(runtimeBuiltins))
        nodeContract(path.join(runtimeDir, target));
      const version = Number(require('vite/package.json').version.split('.')[0]);
      placeModule = async (
        id: string,
        importer?: string,
        resolve?: (id: string, importer?: string) => Promise<string | undefined>,
        requiredExports: string[] = [],
      ) => {
        if (localBuiltins[builtinName(id)] || runtimeBuiltins[builtinName(id)])
          return { available: true };
        if (isBuiltin(id)) return { available: false };
        let resolved: string | undefined;
        try {
          resolved = resolve
            ? await resolve(id)
            : createRequire(importer ?? path.join(root, 'package.json')).resolve(id);
        } catch {}
        const placement: Placement = {
          available: Boolean(
            resolved &&
            (path.isAbsolute(resolved) ||
              resolved.startsWith('\0') ||
              resolved.startsWith('__vite-browser-external') ||
              resolved.startsWith('file:')),
          ),
        };
        if (!resolved || !requiredExports.length || !bare(id)) return placement;
        try {
          const parent = pathToFileURL(importer ?? path.join(root, 'package.json')).href;
          const nativeURL = resolveImport(id, parent);
          if (!nativeURL.startsWith('file:')) return placement;
          const nativeFile = fileURLToPath(nativeURL);
          if (path.resolve(nativeFile) === path.resolve(resolved)) return placement;
          if (!resolve) return placement;
          const browserNames = new Set(
            await moduleExportNames(resolved, (specifier, source) => resolve(specifier, source)),
          );
          const missing = requiredExports.filter((name) => !browserNames.has(name));
          if (!missing.length) return placement;
          const nodeNames = new Set(
            await nodeExportNames(id, importer ? path.dirname(importer) : root),
          );
          if (missing.every((name) => nodeNames.has(name))) {
            nodeFiles.add(nativeFile);
            return { ...placement, replacement: nativeFile, available: true };
          }
        } catch {}
        return placement;
      };
      const optimizer =
        version >= 8
          ? {
              rolldownOptions: {
                plugins: [
                  {
                    name: optimizerPluginName,
                    async resolveId(
                      this: any,
                      id: string,
                      importer?: string,
                      options?: { kind?: string },
                    ) {
                      if (id.endsWith('.node')) {
                        const file = path.isAbsolute(id)
                          ? id
                          : importer
                            ? path.resolve(path.dirname(importer), id)
                            : undefined;
                        if (file) return addonId(addons.addon(file, importer), importer);
                      }
                      if (id === runtimeSpecifier) return path.join(runtimeDir, 'browser.js');
                      const runtime = runtimeBuiltins[builtinName(id)];
                      if (runtime) {
                        const file = nodeContract(path.join(runtimeDir, runtime));
                        return options?.kind === 'require-call' ? commonJSBuiltinId(file) : file;
                      }
                      const local = localBuiltins[builtinName(id)];
                      if (local) return implementationDependency(runtimeRequire.resolve(local));
                      if (id === 'lumiana/client') return { id, external: true };
                      const resolver = await moduleResolver(
                        importer,
                        options?.kind === 'require-call',
                      );
                      if (implementation(importer)) {
                        const resolved = await resolver(id, importer);
                        if (resolved && !resolved.startsWith('__vite-optional-peer-dep:'))
                          return implementationDependency(resolved);
                      }
                      if (resolver === resolveNode || resolver === requireNode) {
                        const resolved = await resolver(id, importer);
                        if (resolved && !resolved.startsWith('__vite-optional-peer-dep:')) {
                          return nodeContract(resolved);
                        }
                      }
                    },
                    load(id: string) {
                      // A false browser mapping is an empty module, not a missing file.
                      if (id.startsWith('__vite-browser-external')) return 'module.exports = {};';
                      if (id.startsWith(commonJSBuiltinPrefix))
                        return commonJSBuiltinSource(commonJSBuiltinTarget(id));
                      if (id.startsWith(addonPrefix)) {
                        const target = addonTarget(id);
                        return `import {nativeAddon} from ${JSON.stringify(runtimeSpecifier)};export default nativeAddon(${JSON.stringify(target.specifier)},${JSON.stringify(target.origin)});`;
                      }
                    },
                    async transform(this: any, code: string, id: string) {
                      if (skip(id)) return null;
                      return transformSource(code, id, {
                        place: (specifier, required, kind) =>
                          placeModule(
                            specifier,
                            id,
                            async (specifier, source = id) =>
                              (await moduleResolver(id, kind === 'require'))(specifier, source),
                            required,
                          ),
                        origin: path.relative(root, id),
                        sourceURL: pathToFileURL(id.split('?')[0]!).href,
                        client: runtimeSpecifier,
                        locateAddon: (request, computed) =>
                          addons.locate(request, id.split('?')[0]!, computed),
                        retainPackage: () => addons.retain(id.split('?')[0]!),
                        retainDependency: (request) =>
                          addons.retainRequest(request, id.split('?')[0]!),
                        nodeGlobals: !dependencyModule(id) || (await usesNodeEnvironment(id)),
                      });
                    },
                  },
                ],
              },
            }
          : {
              esbuildOptions: {
                plugins: [
                  {
                    name: optimizerPluginName,
                    setup(build: import('esbuild').PluginBuild) {
                      build.onResolve({ filter: /.*/ }, async (args) => {
                        if (args.pluginData?.lumianaProbe) return;
                        if (args.path === runtimeSpecifier)
                          return { path: path.join(runtimeDir, 'browser.js') };
                        const runtime = runtimeBuiltins[builtinName(args.path)];
                        if (runtime) {
                          const file = nodeContract(path.join(runtimeDir, runtime));
                          return args.kind === 'require-call'
                            ? { path: file, namespace: 'lumiana-commonjs-builtin' }
                            : { path: file };
                        }
                        const local = localBuiltins[builtinName(args.path)];
                        if (local)
                          return { path: implementationDependency(runtimeRequire.resolve(local)) };
                        if (args.path === 'lumiana/client')
                          return { path: args.path, external: true };
                        const resolver = await moduleResolver(
                          args.importer || undefined,
                          args.kind === 'require-call',
                        );
                        if (implementation(args.importer)) {
                          const resolved = await resolver(args.path, args.importer);
                          if (resolved?.startsWith('__vite-browser-external'))
                            return { path: resolved, namespace: 'lumiana-empty' };
                          if (resolved && !resolved.startsWith('__vite-optional-peer-dep:'))
                            return { path: implementationDependency(resolved) };
                        }
                        if (resolver === resolveNode || resolver === requireNode) {
                          const resolved = await resolver(args.path, args.importer || undefined);
                          if (resolved && !resolved.startsWith('__vite-optional-peer-dep:'))
                            return { path: nodeContract(resolved) };
                        }
                      });
                      build.onLoad({ filter: /.*/, namespace: 'lumiana-empty' }, () => ({
                        contents: 'module.exports = {};',
                        loader: 'js',
                      }));
                      build.onLoad(
                        { filter: /.*/, namespace: 'lumiana-commonjs-builtin' },
                        (args) => ({
                          contents: commonJSBuiltinSource(args.path),
                          loader: 'js',
                          resolveDir: path.dirname(args.path),
                        }),
                      );
                      build.onResolve({ filter: /\.node$/ }, (args) => {
                        const file = path.isAbsolute(args.path)
                          ? args.path
                          : path.resolve(args.resolveDir, args.path);
                        return {
                          path: JSON.stringify({
                            specifier: addons.addon(file, args.importer || file),
                            origin: sourceOrigin(args.importer),
                          }),
                          namespace: 'lumiana-addon',
                        };
                      });
                      build.onLoad({ filter: /.*/, namespace: 'lumiana-addon' }, (args) => {
                        const target = JSON.parse(args.path);
                        return {
                          contents: `import {nativeAddon} from ${JSON.stringify(runtimeSpecifier)};export default nativeAddon(${JSON.stringify(target.specifier)},${JSON.stringify(target.origin)});`,
                          loader: 'js',
                        };
                      });
                      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
                        if (skip(args.path)) return;
                        const code = await fs.readFile(args.path, 'utf8');
                        const transformed = await transformSource(code, args.path, {
                          place: (specifier, required, kind) =>
                            placeModule(
                              specifier,
                              args.path,
                              async (specifier, source = args.path) =>
                                (await moduleResolver(args.path, kind === 'require'))(
                                  specifier,
                                  source,
                                ),
                              required,
                            ),
                          origin: path.relative(root, args.path),
                          sourceURL: pathToFileURL(args.path).href,
                          client: runtimeSpecifier,
                          locateAddon: (request, computed) =>
                            addons.locate(request, args.path, computed),
                          retainPackage: () => addons.retain(args.path),
                          retainDependency: (request) => addons.retainRequest(request, args.path),
                          nodeGlobals:
                            !dependencyModule(args.path) || (await usesNodeEnvironment(args.path)),
                        });
                        if (!transformed) return;
                        const ext = path.extname(args.path).slice(1);
                        return {
                          contents: transformed.code,
                          loader: (['ts', 'tsx', 'jsx'].includes(ext)
                            ? ext
                            : 'js') as import('esbuild').Loader,
                          resolveDir: path.dirname(args.path),
                        };
                      });
                    },
                  },
                ],
              },
            };
      return {
        resolve: {
          alias: localAliases,
        },
        optimizeDeps: {
          exclude: ['lumiana/client', runtimeSpecifier],
          include: Object.keys(localBuiltins).flatMap((id) => [id, `node:${id}`]),
          ...optimizer,
        },
        build: {
          ...(env.command === 'build' || env.isPreview
            ? { outDir: path.join(deploymentDir, 'client') }
            : {}),
        },
      } as UserConfig;
    },
    configResolved(resolved) {
      config = resolved;
      // Linked installs may put browser runtime entries outside the Vite root.
      // Extend resolved rules so workspace detection and explicit user paths survive.
      for (const name of [
        'browser.js',
        'runtime/filesystem.js',
        ...Object.values(runtimeBuiltins),
      ]) {
        const file = normalizePath(path.join(runtimeDir, name));
        if (!config.server.fs.allow.includes(file)) config.server.fs.allow.push(file);
      }
      resolveBrowser = config.createResolver({
        scan: true,
        conditions: ['module', 'browser', 'development|production'],
        mainFields: ['browser', 'module', 'jsnext:main', 'jsnext'],
      });
      resolveNode = config.createResolver({
        scan: true,
        mainFields: ['module', 'jsnext:main', 'jsnext'],
        conditions: ['module', 'node', 'development|production'],
      });
      requireBrowser = config.createResolver({
        scan: true,
        isRequire: true,
        conditions: ['module', 'browser', 'development|production'],
        mainFields: ['browser', 'module', 'jsnext:main', 'jsnext'],
      });
      requireNode = config.createResolver({
        scan: true,
        isRequire: true,
        conditions: ['module', 'node', 'development|production'],
        mainFields: ['module', 'jsnext:main', 'jsnext'],
      });
    },
    async resolveId(id, importer, resolveOptions) {
      if (id.startsWith(commonJSBuiltinPrefix)) return id;
      if (id.startsWith(addonPrefix)) return id;
      if (id.endsWith('.node')) {
        const resolved = path.isAbsolute(id)
          ? id
          : (await this.resolve(id, importer, { ...resolveOptions, skipSelf: true }))?.id;
        if (resolved) return addonId(addons.addon(resolved.split('?')[0]!, importer), importer);
      }
      if (id === 'lumiana/client') return clientId;
      if (id === runtimeSpecifier) return runtimeId;
      const runtime = runtimeBuiltins[builtinName(id)];
      if (runtime) {
        const file = nodeContract(path.join(runtimeDir, runtime));
        return (resolveOptions as any).kind === 'require-call' ? commonJSBuiltinId(file) : file;
      }
      const local = localBuiltins[builtinName(id)];
      if (local) return implementationDependency(runtimeRequire.resolve(local));
      if (id === clientId) return id;
      if (id === runtimeId) return id;
      if (nodeFiles.has(id.split('?')[0]!) && !(resolveOptions as { scan?: boolean }).scan)
        return serveDependency(id);
      if (implementation(importer)) {
        const resolved = await (
          (resolveOptions as any).kind === 'require-call' ? requireBrowser : resolveBrowser
        )(id, importer);
        if (resolved && !resolved.startsWith('__vite-optional-peer-dep:'))
          return serveDependency(implementationDependency(resolved));
      }
      if (importer && (await usesNodeEnvironment(importer))) {
        const required = (resolveOptions as any).kind === 'require-call';
        const resolved = await (required ? requireNode : resolveNode)(id, importer);
        if (resolved) {
          nodeContract(resolved);
          // Raw resolution establishes the execution environment. When both
          // environments select the same file, Vite still owns serving it,
          // including dependency optimization and CommonJS interoperability.
          if (resolved !== (await (required ? requireBrowser : resolveBrowser)(id, importer)))
            return serveDependency(resolved);
        }
      }
    },
    load(id) {
      if (id.startsWith(commonJSBuiltinPrefix))
        return commonJSBuiltinSource(commonJSBuiltinTarget(id));
      if (id === clientId) {
        const runtime = JSON.stringify(path.join(runtimeDir, 'browser.js'));
        return `import {configureClient,lumiana,connect} from ${runtime};configureClient(${JSON.stringify(prefix())});export {lumiana,connect};`;
      }
      if (id === runtimeId)
        return `export * from ${JSON.stringify(path.join(runtimeDir, 'browser.js'))};`;
      if (id.startsWith(addonPrefix)) {
        const target = addonTarget(id);
        return `import {nativeAddon} from ${JSON.stringify(runtimeSpecifier)};export default nativeAddon(${JSON.stringify(target.specifier)},${JSON.stringify(target.origin)});`;
      }
    },
    async transform(code, id, transformOptions) {
      if (transformOptions?.ssr || skip(id)) return;
      return transformSource(code, id, {
        origin: path.relative(config.root, id.split('?')[0]!),
        sourceURL: pathToFileURL(id.split('?')[0]!).href,
        client: runtimeSpecifier,
        locateAddon: (request, computed) => addons.locate(request, id.split('?')[0]!, computed),
        retainPackage: () => addons.retain(id.split('?')[0]!),
        retainDependency: (request) => addons.retainRequest(request, id.split('?')[0]!),
        nodeGlobals: !dependencyModule(id) || (await usesNodeEnvironment(id)),
        place: (specifier, required, kind) =>
          placeModule(
            specifier,
            id,
            async (specifier, source = id) =>
              (await moduleResolver(id, kind === 'require'))(specifier, source),
            required,
          ),
      });
    },
    configureServer(server) {
      devServer = server;
      if (!server.httpServer) throw new Error('Lumiana requires an HTTP server');
      const host = attachHost(server.httpServer, {
        root: config.root,
        ...credentials(),
        path: prefix(),
        mode: 'development',
      });
      server.middlewares.use((req, res, next) => void host.handle(req, res, next));
      const changed = (file: string) => {
        if (file.includes('/node_modules/')) host.invalidate();
      };
      server.watcher.on('change', changed);
      server.httpServer.once('close', () => server.watcher.off('change', changed));
    },
    configurePreviewServer(server) {
      const host = attachHost(server.httpServer, {
        root: config.root,
        ...credentials(),
        path: prefix(),
        mode: 'production',
      });
      server.middlewares.use((req, res, next) => void host.handle(req, res, next));
    },
    buildEnd(error) {
      failed = Boolean(error);
    },
    async closeBundle() {
      if (config.command !== 'build' || failed) return;
      const destination = path.join(deploymentDir, 'server');
      await fs.mkdir(destination, { recursive: true });
      for (const name of ['host.js', 'worker.js', 'run-worker.js'])
        await fs.copyFile(path.join(runtimeDir, name), path.join(destination, name));
      const dependencies = await addons.dependencies();
      await fs.writeFile(
        path.join(deploymentDir, 'package.json'),
        JSON.stringify(
          {
            private: true,
            type: 'module',
            engines: { node: '>=22.18.0' },
            scripts: { start: 'node main.mjs' },
            dependencies,
          },
          null,
          2,
        ) + '\n',
      );
      await fs.writeFile(
        path.join(deploymentDir, 'main.mjs'),
        `import { serve } from './server/host.js';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const server = await serve({
  root,
  clientDir: fileURLToPath(new URL('./client/', import.meta.url)),
  base: ${JSON.stringify(base())},
  path: ${JSON.stringify(prefix())},
  mode: 'production',
  username: process.env.LUMIANA_USERNAME ?? ${JSON.stringify(defaultCredentials.username)},
  password: process.env.LUMIANA_PASSWORD ?? ${JSON.stringify(defaultCredentials.password)},
  port: Number(process.env.LUMIANA_PORT ?? 3883),
  hostname: process.env.LUMIANA_HOST ?? '127.0.0.1',
});
const address = server.address();
const host = address.address === '0.0.0.0' ? '127.0.0.1'
  : address.address === '::' ? '::1' : address.address;
const hostname = host.includes(':') ? '[' + host + ']' : host;
const url = new URL(${JSON.stringify(base())}, 'http://' + hostname + ':' + address.port);
console.log('\\n  Lumiana ready (production)\\n');
console.log('  URL: ' + url.href + '\\n');
`,
      );
    },
  };
}
