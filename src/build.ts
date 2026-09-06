import fs from 'node:fs/promises';
import path from 'node:path';
import { isBuiltin, createRequire } from 'node:module';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { init as initCJS, parse as parseCJS } from 'cjs-module-lexer';
import { init as initESM, parse as parseESM } from 'es-module-lexer';
import { resolve as resolveImport } from 'import-meta-resolve';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MagicString from 'magic-string';
export interface Placement {
  available?: boolean;
  replacement?: string;
}
function unwrapExpression(node: any): any {
  while (
    node &&
    [
      'TSAsExpression',
      'TSTypeAssertion',
      'TSNonNullExpression',
      'TSSatisfiesExpression',
      'ParenthesizedExpression',
    ].includes(node.type)
  )
    node = node.expression;
  return node;
}

const parseCode = (source: string) =>
  parse(source, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx'],
    allowReturnOutsideFunction: true,
  });

/** Whether this module explicitly consumes the Node execution environment. */
export function requiresNodeResolution(source: string): boolean {
  const ast = parseCode(source);
  let required = false;

  const nodeBuiltin = (value: unknown) => typeof value === 'string' && isBuiltin(value);
  const viteEnvironment = (path: any) => {
    const environment = path.parentPath?.node;
    const variable = path.parentPath?.parentPath?.node;
    return (
      environment?.type === 'MemberExpression' &&
      environment.object === path.node &&
      staticKey(environment) === 'env' &&
      variable?.type === 'MemberExpression' &&
      variable.object === environment &&
      staticKey(variable) === 'NODE_ENV'
    );
  };

  traverse(ast as any, {
    ImportDeclaration(path: any) {
      if (nodeBuiltin(path.node.source.value)) required = true;
    },
    ExportNamedDeclaration(path: any) {
      if (nodeBuiltin(path.node.source?.value)) required = true;
    },
    ExportAllDeclaration(path: any) {
      if (nodeBuiltin(path.node.source.value)) required = true;
    },
    CallExpression(path: any) {
      const callee = path.node.callee;
      if (
        callee.type === 'Identifier' &&
        callee.name === 'require' &&
        !path.scope.getBinding('require') &&
        path.node.arguments[0]?.type === 'StringLiteral' &&
        nodeBuiltin(path.node.arguments[0].value)
      )
        required = true;
    },
    ReferencedIdentifier(path: any) {
      if (
        ['__dirname', '__filename'].includes(path.node.name) &&
        !path.scope.getBinding(path.node.name)
      )
        required = true;
      if (
        path.node.name === 'process' &&
        !path.scope.getBinding('process') &&
        path.parentPath?.node.type !== 'UnaryExpression' &&
        !viteEnvironment(path)
      )
        required = true;
    },
  });
  return required;
}
export const bare = (id: string) =>
  !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0');
export class NativeAddons {
  private addons = new Map<string, string>();
  constructor(readonly root: string) {}
  private owner(file: string): { name: string; root: string } {
    const normalized = file.split(path.sep).join('/');
    const marker = '/node_modules/';
    const index = normalized.lastIndexOf(marker);
    if (index < 0) throw new Error(`Native addon ${file} must belong to an installed package`);
    const relative = normalized.slice(index + marker.length);
    const parts = relative.split('/');
    const name = relative.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
    return { name, root: normalized.slice(0, index + marker.length) + name };
  }
  addon(file: string, importer = file): string {
    const normalized = file.split(path.sep).join('/');
    const nativeOwner = this.owner(file);
    let boundaryOwner = nativeOwner;
    try {
      boundaryOwner = this.owner(importer);
    } catch {}
    this.addons.set(boundaryOwner.name, path.join(boundaryOwner.root, 'package.json'));
    return normalized.slice(normalized.lastIndexOf('/node_modules/') + '/node_modules/'.length);
  }
  async locate(request: string, importer: string, computed = false): Promise<string | undefined> {
    if (!computed) {
      try {
        const resolved = createRequire(importer).resolve(request);
        if (request.endsWith('.node')) {
          const deployed = this.addon(resolved, importer);
          return !request.startsWith('.') && !path.isAbsolute(request) ? request : deployed;
        }
      } catch {}
    }
    const owner = this.owner(importer);
    const binaries: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && entry.name.endsWith('.node')) binaries.push(file);
      }
    };
    await visit(owner.root);
    let matches = binaries.filter((file) => path.basename(file) === path.basename(request));
    if (!matches.length && computed) matches = binaries;
    if (!matches.length) return undefined;
    if (computed) {
      const platform = process.platform === 'win32' ? 'win32' : process.platform;
      const host = matches.filter((file) => file.includes(platform) && file.includes(process.arch));
      if (host.length) matches = host;
      return this.addon(matches[0]!, importer);
    }
    if (matches.length > 1) {
      const platform = process.platform === 'win32' ? 'win32' : process.platform;
      const host = matches.filter((file) => file.includes(platform) && file.includes(process.arch));
      if (host.length) matches = host;
    }
    if (matches.length !== 1)
      throw new Error(
        `Cannot choose ${JSON.stringify(request)} for ${owner.name}: ${matches.join(', ')}`,
      );
    return this.addon(matches[0]!, importer);
  }
  async dependencies(): Promise<Record<string, string>> {
    const dependencies: Record<string, string> = {};
    for (const [name, manifest] of this.addons) {
      dependencies[name] = JSON.parse(await fs.readFile(manifest, 'utf8')).version;
    }
    return dependencies;
  }
}
export interface TransformOptions {
  place(id: string, requiredExports?: string[]): Promise<Placement>;
  /** Whether unqualified Node globals belong to this module's execution contract. */
  nodeGlobals?: boolean;
  client?: string;
  process?: string;
  timers?: string;
  locateAddon?(request: string, computed?: boolean): Promise<string | undefined>;
  origin?: string;
  /** Native file URL for the source module represented by this transform. */
  sourceURL?: string;
}
function staticKey(node: any): string | undefined {
  if (node.type !== 'MemberExpression') return;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && ['StringLiteral', 'NumericLiteral'].includes(node.property.type))
    return String(node.property.value);
}

/** A call's receiver and an assignment's target must remain member expressions. */
function valueRead(p: any): boolean {
  for (;;) {
    const parent = p.parentPath;
    if (!parent) return true;
    const n = parent.node;
    if (
      [
        'TSAsExpression',
        'TSTypeAssertion',
        'TSNonNullExpression',
        'TSSatisfiesExpression',
        'ParenthesizedExpression',
      ].includes(n.type)
    ) {
      p = parent;
      continue;
    }
    if (
      (['CallExpression', 'OptionalCallExpression'].includes(n.type) && p.key === 'callee') ||
      (n.type === 'TaggedTemplateExpression' && p.key === 'tag') ||
      (n.type === 'UnaryExpression' && n.operator === 'delete') ||
      n.type === 'UpdateExpression' ||
      (['AssignmentExpression', 'ForInStatement', 'ForOfStatement'].includes(n.type) &&
        p.key === 'left')
    )
      return false;
    if (
      (n.type === 'ObjectProperty' &&
        parent.parent.type === 'ObjectPattern' &&
        p.key === 'value') ||
      ['ObjectPattern', 'ArrayPattern', 'RestElement'].includes(n.type) ||
      (n.type === 'AssignmentPattern' && p.key === 'left')
    ) {
      p = parent;
      continue;
    }
    return true;
  }
}
function extendRead(p: any): { end: any; keys: string[] } {
  const keys: string[] = [];
  let end = p;
  while (end.parentPath?.node.object === end.node && valueRead(end.parentPath)) {
    const key = staticKey(end.parentPath.node);
    if (key === undefined) break;
    keys.push(key);
    end = end.parentPath;
  }
  return { end, keys };
}
/** Transform syntax and lexical bindings, never strings or shadowed identifiers. */
export async function transformSource(source: string, id: string, options: TransformOptions) {
  if (!/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return null;
  let ast: ReturnType<typeof parseCode>;
  try {
    ast = parseCode(source);
  } catch {
    return null;
  }
  const edits = new MagicString(source),
    imports: string[] = [];
  const moduleNodes: any[] = [],
    globals: any[] = [],
    addonCalls: any[] = [],
    dynamicRequires: any[] = [];
  const contextualRequire = new Set<any>();
  const fileURLToPathBindings = new Set<any>();
  const urlModuleBindings = new Set<any>();
  const contextualCalls: any[] = [];
  let moduleLocationChanged = false;
  let moduleSourceChanged = false;
  let counter = 0;
  const reserved = new Set<string>();
  traverse(ast as any, {
    ImportDeclaration(p: any) {
      const module = p.node.source.value.replace(/^node:/, '');
      for (const specifier of p.node.specifiers) {
        if (
          module === 'module' &&
          specifier.type === 'ImportSpecifier' &&
          (specifier.imported.name ?? specifier.imported.value) === 'createRequire'
        ) {
          const binding = p.scope.getBinding(specifier.local.name);
          if (binding) contextualRequire.add(binding);
        }
        if (
          module === 'url' &&
          specifier.type === 'ImportSpecifier' &&
          (specifier.imported.name ?? specifier.imported.value) === 'fileURLToPath'
        ) {
          const binding = p.scope.getBinding(specifier.local.name);
          if (binding) fileURLToPathBindings.add(binding);
        }
        if (
          module === 'url' &&
          ['ImportNamespaceSpecifier', 'ImportDefaultSpecifier'].includes(specifier.type)
        ) {
          const binding = p.scope.getBinding(specifier.local.name);
          if (binding) urlModuleBindings.add(binding);
        }
      }
    },
    Identifier(p: any) {
      reserved.add(p.node.name);
    },
  });
  const name = () => {
    let n;
    do {
      n = `__lumiana${counter++}`;
    } while (reserved.has(n));
    return n;
  };
  const fetchName = name(),
    socketName = name(),
    bufferName = name(),
    processName = name(),
    immediateName = name(),
    clearImmediateName = name(),
    filenameName = name(),
    dirnameName = name(),
    addonName = name(),
    globalName = name();
  const used = new Set<string>();
  const esm = ast.program.body.some(
    (node) => node.type.startsWith('Import') || node.type.startsWith('Export'),
  );
  const importMetaURL = (node: any) =>
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'url' &&
    node.object?.type === 'MetaProperty' &&
    node.object.meta?.name === 'import' &&
    node.object.property?.name === 'meta';
  const viteEnvironment = (p: any) => {
    const environment = p.parentPath?.node;
    const variable = p.parentPath?.parentPath?.node;
    return (
      environment?.type === 'MemberExpression' &&
      environment.object === p.node &&
      staticKey(environment) === 'env' &&
      variable?.type === 'MemberExpression' &&
      variable.object === environment &&
      staticKey(variable) === 'NODE_ENV'
    );
  };
  const replaceModuleLocations = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (importMetaURL(node)) {
      edits.overwrite(node.start, node.end, JSON.stringify(options.sourceURL));
      moduleLocationChanged = true;
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(replaceModuleLocations);
      else if (value && typeof value === 'object' && (value as any).type)
        replaceModuleLocations(value);
    }
  };
  if (options.sourceURL) {
    traverse(ast as any, {
      CallExpression(p: any) {
        const callee = unwrapExpression(p.node.callee);
        const direct =
          callee.type === 'Identifier' &&
          fileURLToPathBindings.has(p.scope.getBinding(callee.name));
        const namespace =
          callee.type === 'MemberExpression' &&
          staticKey(callee) === 'fileURLToPath' &&
          callee.object.type === 'Identifier' &&
          urlModuleBindings.has(p.scope.getBinding(callee.object.name));
        if (direct || namespace) replaceModuleLocations(p.node.arguments[0]);
      },
    });
  }
  if (options.origin) {
    traverse(ast as any, {
      CallExpression(p: any) {
        if (p.node.arguments.length !== 1 || p.node.callee.type !== 'Identifier') return;
        if (contextualRequire.has(p.scope.getBinding(p.node.callee.name))) contextualCalls.push(p);
      },
    });
    for (const factory of contextualCalls) {
      const declaration = factory.parentPath;
      const binding =
        declaration.isVariableDeclarator() && declaration.node.id.type === 'Identifier'
          ? declaration.scope.getBinding(declaration.node.id.name)
          : undefined;
      const unavailable = new Set<string>();
      for (const reference of binding?.referencePaths ?? []) {
        const call = reference.parentPath;
        const argument = call?.node.arguments[0];
        const specifier =
          argument?.type === 'StringLiteral'
            ? argument.value
            : argument?.type === 'TemplateLiteral' && argument.expressions.length === 0
              ? argument.quasis[0].value.cooked
              : undefined;
        if (
          call?.isCallExpression() &&
          call.node.callee === reference.node &&
          specifier !== undefined
        ) {
          if (options.locateAddon && specifier.endsWith('.node')) {
            const located = await options.locateAddon(specifier);
            if (located) {
              used.add('nativeAddon');
              edits.overwrite(
                call.node.start,
                call.node.end,
                `${addonName}(${JSON.stringify(located)},${JSON.stringify(options.origin)})`,
              );
              continue;
            }
          }
          if ((await options.place(specifier)).available === false) unavailable.add(specifier);
        }
      }
      edits.appendLeft(
        factory.node.arguments[0].end,
        `,${JSON.stringify(options.origin)},${JSON.stringify([...unavailable])}`,
      );
    }
  }
  let commonjs = false,
    usesProcess = false,
    usesTimers = false;
  traverse(ast as any, {
    ImportDeclaration(p: any) {
      if (p.node.importKind !== 'type') moduleNodes.push(p);
    },
    ExportAllDeclaration(p: any) {
      moduleNodes.push(p);
    },
    ExportNamedDeclaration(p: any) {
      if (p.node.source && p.node.exportKind !== 'type') moduleNodes.push(p);
    },
    CallExpression(p: any) {
      const loader = unwrapExpression(p.node.callee);
      if (
        options.locateAddon &&
        loader.type === 'CallExpression' &&
        loader.callee.type === 'Identifier' &&
        loader.callee.name === 'require' &&
        !p.scope.getBinding('require') &&
        loader.arguments[0]?.type === 'StringLiteral' &&
        p.node.arguments[0]?.type === 'StringLiteral' &&
        p.node.arguments[0].value.endsWith('.node')
      )
        addonCalls.push(p);
      if (p.node.callee.type !== 'Identifier') return;
      const binding = p.scope.getBinding(p.node.callee.name);
      if (p.node.callee.name === 'require' && !binding) {
        if (p.node.arguments[0]?.type === 'StringLiteral') moduleNodes.push(p);
        else dynamicRequires.push(p);
      }
    },
    ImportExpression(p: any) {
      if (p.node.source.type === 'StringLiteral') moduleNodes.push(p);
    },
    ReferencedIdentifier(p: any) {
      if (
        !esm &&
        ['module', 'exports', 'require'].includes(p.node.name) &&
        !p.scope.getBinding(p.node.name)
      )
        commonjs = true;
      if (p.scope.getBinding(p.node.name)) return;
      if (
        ['fetch', 'WebSocket', 'global', 'Buffer', '__filename', '__dirname'].includes(p.node.name)
      )
        globals.push(p);
      else if (
        options.nodeGlobals !== false &&
        ['process', 'setImmediate', 'clearImmediate'].includes(p.node.name) &&
        !(p.node.name === 'process' && viteEnvironment(p))
      )
        globals.push(p);
    },
  });
  for (const p of moduleNodes) {
    const n = p.node;
    const sourceNode = n.source ?? n.arguments?.[0];
    const specifier = sourceNode?.value;
    if (typeof specifier !== 'string') continue;
    const requiredExports =
      n.type === 'ImportDeclaration'
        ? n.specifiers
            .filter((item: any) => item.type === 'ImportSpecifier' && item.importKind !== 'type')
            .map((item: any) => item.imported.name ?? item.imported.value)
        : n.type === 'ExportNamedDeclaration'
          ? n.specifiers
              .filter((item: any) => item.type !== 'ExportNamespaceSpecifier')
              .map((item: any) => item.local.name ?? item.local.value)
          : n.type === 'CallExpression'
            ? extendRead(p).keys.slice(0, 1)
            : [];
    const placement = await options.place(specifier, requiredExports);
    if (placement.replacement) {
      edits.overwrite(sourceNode.start, sourceNode.end, JSON.stringify(placement.replacement));
      moduleSourceChanged = true;
    }
  }

  for (const p of addonCalls) {
    const located = await options.locateAddon!(p.node.arguments[0].value);
    if (!located) continue;
    used.add('nativeAddon');
    edits.overwrite(
      p.node.start,
      p.node.end,
      `${addonName}(${JSON.stringify(located)},${JSON.stringify(options.origin)})`,
    );
  }

  const addonHint = (node: any, scope: any, seen = new Set<any>()): string | undefined => {
    node = unwrapExpression(node);
    if (!node) return;
    if (node.type === 'StringLiteral') return node.value.endsWith('.node') ? node.value : undefined;
    if (node.type === 'TemplateLiteral') {
      const tail = node.quasis.at(-1)?.value.cooked;
      return tail?.endsWith('.node') ? tail : undefined;
    }
    if (node.type === 'Identifier') {
      const binding = scope.getBinding(node.name);
      if (!binding || seen.has(binding)) return;
      seen.add(binding);
      return addonHint(binding.path.node.init, binding.path.scope, seen);
    }
    if (node.type === 'BinaryExpression' && node.operator === '+')
      return addonHint(node.right, scope, seen) ?? addonHint(node.left, scope, seen);
    if (node.type === 'CallExpression')
      for (const argument of node.arguments) {
        const hint = addonHint(argument, scope, seen);
        if (hint) return hint;
      }
    return;
  };
  if (options.locateAddon)
    for (const p of dynamicRequires) {
      const hint = addonHint(p.node.arguments[0], p.scope);
      if (!hint || !(await options.locateAddon(hint, true))) continue;
      used.add('nativeAddon');
      edits.overwrite(
        p.node.callee.start,
        p.node.callee.end,
        `(specifier=>${addonName}(specifier,${JSON.stringify(options.origin)}))`,
      );
    }

  for (const p of globals) {
    const n = p.node;
    let replacement: string;
    if (n.name === 'fetch') {
      used.add('hybridFetch');
      replacement = fetchName;
    } else if (n.name === 'WebSocket') {
      used.add('HybridWebSocket');
      replacement = socketName;
    } else if (n.name === 'Buffer') {
      used.add('Buffer');
      replacement = bufferName;
    } else if (n.name === 'process') {
      usesProcess = true;
      replacement = processName;
    } else if (n.name === 'global') {
      used.add('nodeGlobal');
      replacement = globalName;
    } else if (n.name === 'setImmediate') {
      usesTimers = true;
      replacement = immediateName;
    } else if (n.name === 'clearImmediate') {
      usesTimers = true;
      replacement = clearImmediateName;
    } else if (n.name === '__filename') {
      used.add('moduleFilename');
      replacement = `${filenameName}(${JSON.stringify(options.origin ?? id)})`;
    } else if (n.name === '__dirname') {
      used.add('moduleDirname');
      replacement = `${dirnameName}(${JSON.stringify(options.origin ?? id)})`;
    } else {
      continue;
    }
    if (p.parent.type === 'ObjectProperty' && p.parent.shorthand && p.key === 'value')
      replacement = `${n.name}: ${replacement}`;
    edits.overwrite(n.start, n.end, replacement);
  }
  if (!used.size && !usesProcess && !usesTimers && !moduleLocationChanged && !moduleSourceChanged)
    return null;
  const names: Record<string, string> = {
    hybridFetch: fetchName,
    HybridWebSocket: socketName,
    Buffer: bufferName,
    moduleDirname: dirnameName,
    moduleFilename: filenameName,
    nativeAddon: addonName,
    nodeGlobal: globalName,
  };
  const commonRuntime = 'globalThis[Symbol.for("lumiana.runtime")]';
  if (usesProcess)
    imports.push(
      commonjs
        ? `const {process:${processName}}=${commonRuntime};\n`
        : `import ${processName} from ${JSON.stringify(options.process ?? 'node:process')};\n`,
    );
  if (usesTimers)
    imports.push(
      commonjs
        ? `const {setImmediate:${immediateName},clearImmediate:${clearImmediateName}}=${commonRuntime};\n`
        : `import {setImmediate as ${immediateName},clearImmediate as ${clearImmediateName}} from ${JSON.stringify(options.timers ?? 'node:timers')};\n`,
    );
  if (used.size)
    imports.push(
      commonjs
        ? `const {${[...used].map((key) => `${key}:${names[key]}`).join(',')}}=${commonRuntime};\n`
        : `import {${[...used].map((key) => `${key} as ${names[key]}`).join(',')}} from ${JSON.stringify(options.client ?? 'lumiana/runtime')};\n`,
    );
  const prologue = ast.program.directives.at(-1)?.end ?? ast.program.interpreter?.end ?? 0;
  edits.appendLeft(prologue, (prologue ? '\n' : '') + imports.join(''));
  return {
    code: edits.toString(),
    map: edits.generateMap({ hires: true, source: id, includeContent: true }).toString(),
  };
}

/** Follow export-all edges using the caller's resolver without executing the module graph. */
export async function moduleExportNames(
  file: string,
  resolve: (id: string, importer: string) => Promise<string | undefined>,
  seen = new Set<string>(),
): Promise<string[]> {
  const resolvedFile = file.startsWith('file:') ? fileURLToPath(file) : file.split('?')[0]!;
  if (!path.isAbsolute(resolvedFile) || seen.has(resolvedFile)) return [];
  seen.add(resolvedFile);
  const source = await fs.readFile(resolvedFile, 'utf8');
  await Promise.all([initCJS(), initESM]);
  const names = new Set<string>(),
    reexports = new Set<string>();
  try {
    for (const item of parseESM(source)[1]) names.add(item.n);
  } catch {}
  try {
    const parsed = parseCJS(source);
    for (const name of parsed.exports) names.add(name);
    for (const id of parsed.reexports) reexports.add(id);
  } catch {}
  try {
    for (const node of parseCode(source).program.body)
      if (node.type === 'ExportAllDeclaration') reexports.add(node.source.value);
  } catch {}
  for (const id of reexports) {
    const target = await resolve(id, resolvedFile).catch(() => undefined);
    if (!target) continue;
    for (const name of await moduleExportNames(target, resolve, seen)) names.add(name);
  }
  names.delete('__esModule');
  return [...names].sort();
}

/** Use the same static export evidence as module loaders; never execute packages. */
export async function nodeExportNames(
  id: string,
  root: string,
  seen = new Set<string>(),
): Promise<string[]> {
  if (isBuiltin(id))
    return Object.keys(createRequire(import.meta.url)(id)).filter((n) => n !== 'default');
  const url = resolveImport(id, pathToFileURL(path.join(root, 'package.json')).href);
  if (seen.has(url)) return [];
  seen.add(url);
  const file = fileURLToPath(url),
    source = await fs.readFile(file, 'utf8');
  await Promise.all([initCJS(), initESM]);
  const names = new Set<string>(),
    reexports = new Set<string>();
  try {
    for (const item of parseESM(source)[1]) names.add(item.n);
  } catch {}
  try {
    const parsed = parseCJS(source);
    for (const name of parsed.exports) names.add(name);
    for (const id of parsed.reexports) reexports.add(id);
  } catch {}
  try {
    for (const node of parseCode(source).program.body)
      if (node.type === 'ExportAllDeclaration') reexports.add(node.source.value);
  } catch {}
  for (const id of reexports)
    for (const name of await nodeExportNames(id, path.dirname(file), seen)) names.add(name);
  names.delete('default');
  names.delete('__esModule');
  return [...names].sort();
}
