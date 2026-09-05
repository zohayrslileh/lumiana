import type { Plugin, ResolvedConfig, UserConfig } from 'vite';
import { normalizePath } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
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
const clientId = '\0lumiana:client';
const runtimeId = '\0lumiana:runtime';
const runtimeSpecifier = 'lumiana/runtime';
const addonPrefix = '\0lumiana:addon:';
const localBuiltins: Record<string, string> = Object.assign(Object.create(null), {
  events: 'events/',
  buffer: 'buffer/',
  assert: 'assert/',
  path: 'path-browserify',
  querystring: 'querystring-es3',
  stream: 'stream-browserify',
  string_decoder: 'string_decoder/',
});
const runtimeBuiltins: Record<string, string> = Object.assign(Object.create(null), {
  child_process: 'runtime/child-process.js',
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
  'stream/promises': 'runtime/stream-promises.js',
  timers: 'runtime/timers.js',
  tls: 'runtime/tls.js',
  tty: 'runtime/tty.js',
  url: 'runtime/url.js',
  util: 'runtime/util.js',
  v8: 'runtime/v8.js',
  vm: 'runtime/vm.js',
  crypto: 'runtime/crypto.js',
  zlib: 'runtime/zlib.js',
});
const builtinName = (id: string) => id.replace(/^node:/, '');
const exact = (id: string) => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
export function lumiana(options: LumianaPluginOptions = {}): Plugin {
  let resolveBrowser: ReturnType<ResolvedConfig['createResolver']>;
  let resolveNode: ReturnType<ResolvedConfig['createResolver']>;
  let config: ResolvedConfig,
    addons: NativeAddons,
    deploymentDir: string,
    failed = false;
  const execution = new Map<string, Promise<boolean>>();
  const nodeFiles = new Set<string>();
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
    if (!id || id.startsWith('\0')) return Promise.resolve(false);
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
  const moduleResolver = async (importer?: string) =>
    (await usesNodeEnvironment(importer)) ? resolveNode : resolveBrowser;
  return {
    name: 'lumiana',
    enforce: 'pre',
    config(user, env) {
      const root = path.resolve(user.root ?? process.cwd());
      addons = new NativeAddons(root);
      deploymentDir = path.resolve(root, user.build?.outDir ?? 'dist');
      const require = createRequire(path.join(root, 'package.json'));
      const localAliases = Object.entries(localBuiltins).flatMap(([id, target]) => {
        const replacement = nodeContract(runtimeRequire.resolve(target));
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
        if (isBuiltin(id))
          throw new Error(`Lumiana has no local runtime contract for ${JSON.stringify(id)}`);
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
                    name: 'lumiana-dependencies',
                    async resolveId(this: any, id: string, importer?: string) {
                      if (id.endsWith('.node')) {
                        const file = path.isAbsolute(id)
                          ? id
                          : importer
                            ? path.resolve(path.dirname(importer), id)
                            : undefined;
                        if (file) return addonPrefix + addons.addon(file);
                      }
                      if (id === runtimeSpecifier) return path.join(runtimeDir, 'browser.js');
                      const runtime = runtimeBuiltins[builtinName(id)];
                      if (runtime) return nodeContract(path.join(runtimeDir, runtime));
                      const local = localBuiltins[builtinName(id)];
                      if (local) return nodeContract(runtimeRequire.resolve(local));
                      if (id === 'lumiana/client') return { id, external: true };
                      const resolver = await moduleResolver(importer);
                      if (resolver === resolveNode) {
                        const resolved = await resolver(id, importer);
                        if (resolved) {
                          return nodeContract(resolved);
                        }
                      }
                    },
                    load(id: string) {
                      if (id.startsWith(addonPrefix))
                        return `import {nativeAddon} from ${JSON.stringify(runtimeSpecifier)};export default nativeAddon(${JSON.stringify(id.slice(addonPrefix.length))});`;
                    },
                    async transform(this: any, code: string, id: string) {
                      if (skip(id)) return null;
                      return transformSource(code, id, {
                        place: (specifier, required) =>
                          placeModule(
                            specifier,
                            id,
                            async (specifier, source = id) =>
                              (await moduleResolver(id))(specifier, source),
                            required,
                          ),
                        origin: path.relative(root, id),
                        sourceURL: pathToFileURL(id.split('?')[0]!).href,
                        client: runtimeSpecifier,
                        locateAddon: (request, computed) =>
                          addons.locate(request, id.split('?')[0]!, computed),
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
                    name: 'lumiana-dependencies',
                    setup(build: import('esbuild').PluginBuild) {
                      build.onResolve({ filter: /.*/ }, async (args) => {
                        if (args.pluginData?.lumianaProbe) return;
                        if (args.path === runtimeSpecifier)
                          return { path: path.join(runtimeDir, 'browser.js') };
                        const runtime = runtimeBuiltins[builtinName(args.path)];
                        if (runtime) return { path: nodeContract(path.join(runtimeDir, runtime)) };
                        const local = localBuiltins[builtinName(args.path)];
                        if (local) return { path: nodeContract(runtimeRequire.resolve(local)) };
                        if (args.path === 'lumiana/client')
                          return { path: args.path, external: true };
                        const resolver = await moduleResolver(args.importer || undefined);
                        if (resolver === resolveNode) {
                          const resolved = await resolver(args.path, args.importer || undefined);
                          if (resolved) return { path: nodeContract(resolved) };
                        }
                      });
                      build.onResolve({ filter: /\.node$/ }, (args) => {
                        const file = path.isAbsolute(args.path)
                          ? args.path
                          : path.resolve(args.resolveDir, args.path);
                        return {
                          path: addons.addon(file),
                          namespace: 'lumiana-addon',
                        };
                      });
                      build.onLoad({ filter: /.*/, namespace: 'lumiana-addon' }, (args) => ({
                        contents: `import {nativeAddon} from ${JSON.stringify(runtimeSpecifier)};export default nativeAddon(${JSON.stringify(args.path)});`,
                        loader: 'js',
                      }));
                      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
                        if (skip(args.path)) return;
                        const code = await fs.readFile(args.path, 'utf8');
                        const transformed = await transformSource(code, args.path, {
                          place: (specifier, required) =>
                            placeModule(
                              specifier,
                              args.path,
                              async (specifier, source = args.path) =>
                                (await moduleResolver(args.path))(specifier, source),
                              required,
                            ),
                          origin: path.relative(root, args.path),
                          sourceURL: pathToFileURL(args.path).href,
                          client: runtimeSpecifier,
                          locateAddon: (request, computed) =>
                            addons.locate(request, args.path, computed),
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
        resolve: { alias: localAliases },
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
      for (const name of ['browser.js', ...Object.values(runtimeBuiltins)]) {
        const file = normalizePath(path.join(runtimeDir, name));
        if (!config.server.fs.allow.includes(file)) config.server.fs.allow.push(file);
      }
      resolveBrowser = config.createResolver({ scan: true });
      resolveNode = config.createResolver({
        scan: true,
        mainFields: ['module', 'jsnext:main', 'jsnext'],
        conditions: ['module', 'node', 'development|production'],
      });
    },
    async resolveId(id, importer, resolveOptions) {
      if (id.startsWith(addonPrefix)) return id;
      if (id.endsWith('.node')) {
        const resolved = path.isAbsolute(id)
          ? id
          : (await this.resolve(id, importer, { ...resolveOptions, skipSelf: true }))?.id;
        if (resolved) return addonPrefix + addons.addon(resolved.split('?')[0]!);
      }
      if (id === 'lumiana/client') return clientId;
      if (id === runtimeSpecifier) return runtimeId;
      const runtime = runtimeBuiltins[builtinName(id)];
      if (runtime) return nodeContract(path.join(runtimeDir, runtime));
      const local = localBuiltins[builtinName(id)];
      if (local) return nodeContract(runtimeRequire.resolve(local));
      if (id === clientId) return id;
      if (id === runtimeId) return id;
      if (importer && (await usesNodeEnvironment(importer))) {
        const resolved = await resolveNode(id, importer);
        if (resolved) return nodeContract(resolved);
      }
    },
    load(id) {
      if (id === clientId) {
        const runtime = JSON.stringify(path.join(runtimeDir, 'browser.js'));
        return `import {configureClient,lumiana,connect} from ${runtime};configureClient(${JSON.stringify(prefix())});export {lumiana,connect};`;
      }
      if (id === runtimeId)
        return `export * from ${JSON.stringify(path.join(runtimeDir, 'browser.js'))};`;
      if (id.startsWith(addonPrefix))
        return `import {nativeAddon} from ${JSON.stringify(runtimeSpecifier)};export default nativeAddon(${JSON.stringify(id.slice(addonPrefix.length))});`;
    },
    async transform(code, id, transformOptions) {
      if (transformOptions?.ssr || skip(id)) return;
      return transformSource(code, id, {
        origin: path.relative(config.root, id.split('?')[0]!),
        sourceURL: pathToFileURL(id.split('?')[0]!).href,
        client: runtimeSpecifier,
        locateAddon: (request, computed) => addons.locate(request, id.split('?')[0]!, computed),
        nodeGlobals: !dependencyModule(id) || (await usesNodeEnvironment(id)),
        place: (specifier, required) =>
          placeModule(
            specifier,
            id,
            async (specifier, source = id) => (await moduleResolver(id))(specifier, source),
            required,
          ),
      });
    },
    configureServer(server) {
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
      for (const name of ['host.js', 'worker.js'])
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
