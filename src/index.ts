import type { Plugin, ResolvedConfig, UserConfig } from 'vite';
import { normalizePath } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin, createRequire } from 'node:module';
import { resolve as resolveImport } from 'import-meta-resolve';
import { attachHost } from './host.js';
import {
  Bundling,
  bare,
  transformSource,
  directExportNames,
  nativeExportNames,
  type Placement,
} from './build.js';
export interface LumianaPluginOptions {
  defaultCredentials?: {
    username?: string;
    password?: string;
  };
  /** Packages to execute natively instead of including them in the browser bundle. */
  nodeModules?: (string | RegExp)[];
}
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const clientId = '\0lumiana:client';
const localBuiltins: Record<string, string> = Object.assign(Object.create(null), {
  events: 'events/',
  buffer: 'buffer/',
  util: 'util/',
});
export function lumiana(options: LumianaPluginOptions = {}): Plugin {
  let resolveBrowser: ReturnType<ResolvedConfig['createResolver']>;
  let config: ResolvedConfig,
    bundling: Bundling,
    deploymentDir: string,
    failed = false;
  let placeModule: (
    id: string,
    importer?: string,
    resolve?: (id: string) => Promise<string | undefined>,
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
  const native = (id: string) => isBuiltin(id) && !localBuiltins[id.replace(/^node:/, '')];
  return {
    name: 'lumiana',
    enforce: 'pre',
    config(user, env) {
      const root = path.resolve(user.root ?? process.cwd());
      bundling = new Bundling(root, options.nodeModules);
      deploymentDir = path.resolve(root, user.build?.outDir ?? 'dist');
      const require = createRequire(path.join(root, 'package.json'));
      const version = Number(require('vite/package.json').version.split('.')[0]);
      placeModule = async (
        id: string,
        importer?: string,
        resolve?: (id: string) => Promise<string | undefined>,
        requiredExports: string[] = [],
      ) => {
        if (localBuiltins[id.replace(/^node:/, '')]) return { native: false };
        let resolved: string | undefined;
        try {
          resolved = resolve
            ? await resolve(id)
            : createRequire(importer ?? path.join(root, 'package.json')).resolve(id);
        } catch {}
        const placement = await bundling.placement(id, resolved);
        if (placement.native || !resolved || !requiredExports.length || !bare(id)) return placement;
        try {
          const parent = pathToFileURL(importer ?? path.join(root, 'package.json')).href;
          const nativeURL = resolveImport(id, parent);
          if (!nativeURL.startsWith('file:')) return placement;
          const nativeFile = fileURLToPath(nativeURL);
          if (path.resolve(nativeFile) === path.resolve(resolved)) return placement;
          const browserNames = new Set(await directExportNames(resolved));
          const missing = requiredExports.filter((name) => !browserNames.has(name));
          if (!missing.length) return placement;
          const nativeNames = new Set(
            await nativeExportNames(id, importer ? path.dirname(importer) : root),
          );
          if (missing.every((name) => nativeNames.has(name)))
            return bundling.unavailable(id, missing);
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
                      if (id === 'lumiana/internal') return path.join(runtimeDir, 'access.js');
                      const local = localBuiltins[id.replace(/^node:/, '')];
                      if (local) return require.resolve(local);
                      if (id === 'lumiana/client') return { id, external: true };
                      if (
                        (
                          await placeModule(id, importer, (specifier) =>
                            resolveBrowser(specifier, importer),
                          )
                        ).native
                      )
                        return { id, external: true };
                    },
                    async transform(this: any, code: string, id: string) {
                      if (skip(id)) return null;
                      return transformSource(code, id, {
                        place: (specifier, required) =>
                          placeModule(
                            specifier,
                            id,
                            (specifier) => resolveBrowser(specifier, id),
                            required,
                          ),
                        origin: path.relative(root, id),
                        nativeOrigin: (specifier) => bundling.origin(id, specifier),
                        nativeUsage: (id) => bundling.usage(id),
                        nativeSegment: (id) => bundling.segment(id),
                        names: (specifier) => nativeExportNames(specifier, path.dirname(id)),
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
                        if (args.path === 'lumiana/internal')
                          return { path: path.join(runtimeDir, 'access.js') };
                        const local = localBuiltins[args.path.replace(/^node:/, '')];
                        if (local) return { path: require.resolve(local) };
                        if (args.path === 'lumiana/client')
                          return { path: args.path, external: true };
                        if (
                          (
                            await placeModule(
                              args.path,
                              args.importer || undefined,
                              async (specifier) =>
                                (
                                  await build.resolve(specifier, {
                                    kind: args.kind,
                                    resolveDir: args.resolveDir,
                                    pluginData: { lumianaProbe: true },
                                  })
                                ).path,
                            )
                          ).native
                        )
                          return { path: args.path, external: true };
                      });
                      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
                        if (skip(args.path)) return;
                        const code = await fs.readFile(args.path, 'utf8');
                        const transformed = await transformSource(code, args.path, {
                          place: (specifier, required) =>
                            placeModule(
                              specifier,
                              args.path,
                              async (specifier) =>
                                (
                                  await build.resolve(specifier, {
                                    kind: 'import-statement',
                                    resolveDir: path.dirname(args.path),
                                    pluginData: { lumianaProbe: true },
                                  })
                                ).path,
                              required,
                            ),
                          origin: path.relative(root, args.path),
                          nativeOrigin: (specifier) => bundling.origin(args.path, specifier),
                          nativeUsage: (id) => bundling.usage(id),
                          nativeSegment: (id) => bundling.segment(id),
                          names: (id) => nativeExportNames(id, path.dirname(args.path)),
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
        optimizeDeps: {
          exclude: ['lumiana/client'],
          include: Object.values(localBuiltins),
          ...optimizer,
        },
        build: {
          ...(env.command === 'build' || env.isPreview
            ? { outDir: path.join(deploymentDir, 'public') }
            : {}),
        },
      } as UserConfig;
    },
    configResolved(resolved) {
      config = resolved;
      // Linked installs may put browser runtime entries outside the Vite root.
      // Extend resolved rules so workspace detection and explicit user paths survive.
      for (const name of ['client.js', 'access.js']) {
        const file = normalizePath(path.join(runtimeDir, name));
        if (!config.server.fs.allow.includes(file)) config.server.fs.allow.push(file);
      }
      resolveBrowser = config.createResolver({ scan: true });
    },
    async resolveId(id, importer, resolveOptions) {
      if (id === 'lumiana/client') return clientId;
      if (id === 'lumiana/internal') return path.join(runtimeDir, 'access.js');
      const local = localBuiltins[id.replace(/^node:/, '')];
      if (local) return this.resolve(local, importer, { ...resolveOptions, skipSelf: true });
      if (id === clientId) return id;
      if (native(id) && !resolveOptions?.ssr) {
        // Imports are rewritten before analysis. This catches dependency scanner
        // requests without turning a built-in import into package exclusion.
        return { id, external: true };
      }
    },
    load(id) {
      if (id === clientId) {
        const client = JSON.stringify(path.join(runtimeDir, 'client.js'));
        return `import {configureClient} from ${client};configureClient(${JSON.stringify(prefix())});export * from ${client};`;
      }
    },
    async transform(code, id, transformOptions) {
      if (transformOptions?.ssr || skip(id)) return;
      return transformSource(code, id, {
        origin: path.relative(config.root, id.split('?')[0]!),
        nativeOrigin: (specifier) => bundling.origin(id.split('?')[0]!, specifier),
        nativeUsage: (id) => bundling.usage(id),
        nativeSegment: (id) => bundling.segment(id),
        names: (specifier) => nativeExportNames(specifier, path.dirname(id)),
        place: (specifier, required) =>
          placeModule(specifier, id, (specifier) => resolveBrowser(specifier, id), required),
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
        bundling.clear();
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
      const require = createRequire(import.meta.url);
      const dependencies = {
        ...(await bundling.dependencies()),
        ws: require('ws/package.json').version,
        buffer: require('buffer/package.json').version,
      };
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
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
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
export default lumiana;
