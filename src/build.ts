import fs from 'node:fs/promises';
import path from 'node:path';
import { isBuiltin, createRequire } from 'node:module';
import { build } from 'esbuild';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { init as initCJS, parse as parseCJS } from 'cjs-module-lexer';
import { init as initESM, parse as parseESM } from 'es-module-lexer';
import { resolve as resolveImport } from 'import-meta-resolve';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MagicString from 'magic-string';
import type { NativeExpression } from './protocol.js';
export interface Placement {
  native: boolean;
  reason?: string;
  nativeExports?: string[];
}
const portableBuiltins = new Set([
  'buffer',
  'node:buffer',
  'events',
  'node:events',
  'util',
  'node:util',
  'fs/promises',
  'node:fs/promises',
  'assert',
  'node:assert',
  'path',
  'node:path',
  'process',
  'node:process',
  'querystring',
  'node:querystring',
  'stream',
  'node:stream',
  'string_decoder',
  'node:string_decoder',
  'url',
  'node:url',
  'net',
  'node:net',
  'http',
  'node:http',
]);
const nativeGlobals = new Set(['process', 'global', 'setImmediate', 'clearImmediate']);

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

/** Find exports whose implementation transitively depends on a native capability. */
function nativeCapabilityExports(source: string): string[] {
  const ast = parseCode(source);
  let program: any;
  traverse(ast as any, {
    Program(path: any) {
      program = path;
    },
  });
  const exports = new Map<string, string>();
  for (const node of ast.program.body as any[]) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id?.name)
        exports.set(node.declaration.id.name, node.declaration.id.name);
      for (const declaration of node.declaration?.declarations ?? [])
        if (declaration.id.type === 'Identifier')
          exports.set(declaration.id.name, declaration.id.name);
      if (!node.source)
        for (const specifier of node.specifiers)
          if (specifier.local?.name)
            exports.set(specifier.exported.name ?? specifier.exported.value, specifier.local.name);
    } else if (node.type === 'ExportDefaultDeclaration') {
      const local = node.declaration?.id?.name ?? node.declaration?.name;
      if (local) exports.set('default', local);
    }
  }
  const memo = new Map<any, boolean>(),
    visiting = new Set<any>();
  const depends = (binding: any): boolean => {
    if (!binding) return false;
    if (memo.has(binding)) return memo.get(binding)!;
    if (visiting.has(binding)) return false;
    visiting.add(binding);
    const declaration = binding.path.parentPath;
    if (declaration?.isImportDeclaration()) {
      const source = declaration.node.source.value;
      const result = isBuiltin(source) && !portableBuiltins.has(source);
      visiting.delete(binding);
      memo.set(binding, result);
      return result;
    }
    let result = false;
    binding.path.traverse({
      ReferencedIdentifier(path: any) {
        if (result) return;
        const dependency = path.scope.getBinding(path.node.name);
        if (!dependency) result = nativeGlobals.has(path.node.name);
        else if (dependency !== binding) result = depends(dependency);
      },
    });
    visiting.delete(binding);
    memo.set(binding, result);
    return result;
  };
  return [...exports]
    .filter(([, local]) => {
      const binding = program.scope.getBinding(local);
      // A direct re-export is already a native reference after normal bundling.
      // Moving its package would add no execution locality.
      return binding && !binding.path.isImportSpecifier() && depends(binding);
    })
    .map(([name]) => name);
}
const parseCode = (source: string) =>
  parse(source, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx'],
    allowReturnOutsideFunction: true,
  });
export const packageName = (id: string) =>
  id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]!;
export const bare = (id: string) =>
  !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0');
export class Bundling {
  private cache = new Map<string, Promise<Placement>>();
  readonly external = new Map<string, string>();
  private dynamic = false;
  private nested = new Set<string>();
  origin(file: string, specifier: string): void {
    if (isBuiltin(specifier)) return;
    const relative = path.relative(this.root, file);
    if (!relative.startsWith('node_modules' + path.sep)) return;
    const owner = packageName(relative.slice('node_modules/'.length).split(path.sep).join('/'));
    this.external.set(owner, 'Native dependencies resolve relative to this package');
    if (bare(specifier) && !isBuiltin(specifier)) {
      try {
        createRequire(path.join(this.root, 'package.json')).resolve(specifier);
      } catch {
        try {
          createRequire(file).resolve(specifier);
          this.nested.add(packageName(specifier));
        } catch {}
      }
    }
  }
  usage(id?: string): void {
    if (id === undefined) this.dynamic = true;
    else if (bare(id) && !isBuiltin(id))
      this.external.set(packageName(id), 'Native handler requested through node()');
  }
  segment(id: string): void {
    if (!isBuiltin(id)) this.external.set(packageName(id), 'Native-dependent export');
  }
  unavailable(id: string, names: string[]): Placement {
    const reason = `Browser condition omits ${names.join(', ')}`;
    if (!isBuiltin(id)) this.external.set(packageName(id), reason);
    return { native: true, reason };
  }
  constructor(
    readonly root: string,
    private exclusions: (string | RegExp)[] = [],
  ) {}
  clear(): void {
    this.cache.clear();
  }
  async placement(id: string, file?: string): Promise<Placement> {
    if (isBuiltin(id)) return { native: true, reason: 'Node built-in' };
    if (
      this.exclusions.some((item) =>
        typeof item === 'string'
          ? id === item || id.startsWith(item + '/')
          : ((item.lastIndex = 0), item.test(id)),
      )
    ) {
      this.external.set(packageName(id), 'Explicit nodeModules exclusion');
      return { native: true, reason: 'Explicit nodeModules exclusion' };
    }
    if (!file || !bare(id) || id === 'lumiana' || id.startsWith('lumiana/'))
      return { native: false };
    let pending = this.cache.get(file);
    if (!pending) {
      pending = this.probe(file);
      this.cache.set(file, pending);
    }
    const placement = await pending;
    if (placement.native) this.external.set(packageName(id), placement.reason!);
    return placement;
  }
  private async probe(file: string): Promise<Placement> {
    let reason: string | undefined;
    try {
      await build({
        entryPoints: [file],
        absWorkingDir: this.root,
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [
          {
            name: 'lumiana-bundlability',
            setup(build) {
              build.onResolve({ filter: /.*/ }, (args) =>
                isBuiltin(args.path) ? { path: args.path, external: true } : undefined,
              );
              build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
                const contents = await fs.readFile(args.path, 'utf8');
                const ast = parseCode(contents);
                traverse(ast as any, {
                  ReferencedIdentifier(p: any) {
                    if (
                      ['__dirname', '__filename'].includes(p.node.name) &&
                      !p.scope.getBinding(p.node.name)
                    )
                      reason = `Native module-relative ${p.node.name}`;
                  },
                  CallExpression(p: any) {
                    const n = p.node;
                    if (
                      n.callee.type === 'MemberExpression' &&
                      n.callee.object.name === 'require' &&
                      !p.scope.getBinding('require')
                    )
                      reason = 'Native module resolver access';
                    if (
                      n.callee.type === 'MemberExpression' &&
                      n.callee.object.name === 'process' &&
                      !p.scope.getBinding('process') &&
                      n.callee.property.name === 'dlopen'
                    )
                      reason = 'Native addon loading through process.dlopen';
                  },
                });
                return undefined;
              });
            },
          },
        ],
      });
      if (reason) return { native: true, reason };
      let nativeExports: string[] = [];
      if (/\.[cm]?[jt]sx?$/.test(file))
        try {
          nativeExports = nativeCapabilityExports(await fs.readFile(file, 'utf8'));
        } catch {}
      return { native: false, nativeExports };
    } catch (error: any) {
      return { native: true, reason: error.errors?.[0]?.text ?? error.message };
    }
  }
  async dependencies(): Promise<Record<string, string>> {
    const require = createRequire(path.join(this.root, 'package.json')),
      result: Record<string, string> = {};
    if (this.dynamic) {
      const pkg = JSON.parse(await fs.readFile(path.join(this.root, 'package.json'), 'utf8'));
      for (const name of Object.keys(pkg.dependencies ?? {}))
        if (name !== 'lumiana') this.external.set(name, 'Dynamically selected native handler');
    }
    for (const name of this.external.keys()) {
      if (this.nested.has(name)) continue;
      let found = false;
      for (const directory of require.resolve.paths(name) ?? []) {
        try {
          const pkg = JSON.parse(
            await fs.readFile(path.join(directory, name, 'package.json'), 'utf8'),
          );
          result[name] = pkg.version;
          found = true;
          break;
        } catch {}
      }
      if (!found) throw new Error(`Cannot resolve production dependency ${name}`);
    }
    return result;
  }
}
export interface TransformOptions {
  place(id: string, requiredExports?: string[]): Promise<Placement>;
  client?: string;
  access?: string;
  nativeUsage?(id?: string): void;
  nativeSegment?(id: string): void;
  origin?: string;
  nativeOrigin?(specifier: string): void;
  names?(id: string): Promise<string[]>;
}
const portableIntrinsics = new Set(['JSON', 'Math', 'Object', 'Reflect']);
function nativeExpression(
  node: any,
  scope: any,
): { expression: NativeExpression; native: boolean } | undefined {
  if (node.type === 'NullLiteral')
    return { expression: { kind: 'literal', value: null }, native: false };
  if (['BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(node.type))
    return { expression: { kind: 'literal', value: node.value }, native: false };
  if (node.type === 'Identifier' && nativeGlobals.has(node.name) && !scope.getBinding(node.name))
    return { expression: { kind: 'global', name: node.name }, native: true };
  if (node.type === 'MemberExpression') {
    const key = staticKey(node),
      object = key === undefined ? undefined : nativeExpression(node.object, scope);
    if (object)
      return {
        expression: { kind: 'get', object: object.expression, key: key! },
        native: object.native,
      };
  }
}
function staticKey(node: any): string | undefined {
  if (node.type !== 'MemberExpression') return;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && ['StringLiteral', 'NumericLiteral'].includes(node.property.type))
    return String(node.property.value);
}

/** Expressions whose evaluation cannot observe moving a remote property read past them. */
function stableArgument(node: any): boolean {
  node = unwrapExpression(node);
  if (!node) return false;
  if (
    [
      'NullLiteral',
      'BooleanLiteral',
      'NumericLiteral',
      'StringLiteral',
      'BigIntLiteral',
      'RegExpLiteral',
      'FunctionExpression',
      'ArrowFunctionExpression',
    ].includes(node.type)
  )
    return true;
  if (node.type === 'TemplateLiteral')
    return node.expressions.every((expression: any) => stableArgument(expression));
  if (node.type === 'UnaryExpression' && node.operator !== 'delete')
    return stableArgument(node.argument);
  if (node.type === 'ArrayExpression')
    return node.elements.every(
      (element: any) =>
        element === null || (element.type !== 'SpreadElement' && stableArgument(element)),
    );
  if (node.type === 'ObjectExpression')
    return node.properties.every(
      (property: any) =>
        property.type === 'ObjectProperty' &&
        !property.computed &&
        !property.method &&
        stableArgument(property.value),
    );
  return false;
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
    dynamicRequires: any[] = [],
    globals: any[] = [],
    members: any[] = [],
    calls: any[] = [],
    variables: any[] = [];
  let counter = 0;
  const reserved = new Set<string>();
  traverse(ast as any, {
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
  const nodeName = name(),
    bindingsName = name(),
    importName = name(),
    nativeName = name(),
    fetchName = name(),
    socketName = name(),
    bufferName = name(),
    readName = name(),
    evaluateName = name(),
    invokeName = name();
  const used = new Set<string>();
  const esm = ast.program.body.some(
    (node) => node.type.startsWith('Import') || node.type.startsWith('Export'),
  );
  let commonjs = false;
  traverse(ast as any, {
    MemberExpression: {
      exit(p: any) {
        members.push(p);
      },
    },
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
      calls.push(p);
      if (p.node.callee.type !== 'Identifier') return;
      const binding = p.scope.getBinding(p.node.callee.name);
      if (p.node.callee.name === 'require' && !binding) {
        if (p.node.arguments[0]?.type === 'StringLiteral') moduleNodes.push(p);
        else dynamicRequires.push(p);
      }
      if (
        binding?.path.node.type === 'ImportSpecifier' &&
        ['node', 'importNode'].includes(binding.path.node.imported.name) &&
        binding.path.parent.source.value === 'lumiana/client'
      )
        options.nativeUsage?.(
          p.node.arguments[0]?.type === 'StringLiteral' ? p.node.arguments[0].value : undefined,
        );
    },
    VariableDeclarator(p: any) {
      variables.push(p);
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
      if (
        !p.scope.getBinding(p.node.name) &&
        [
          'fetch',
          'WebSocket',
          'Buffer',
          'process',
          'global',
          'setImmediate',
          'clearImmediate',
        ].includes(p.node.name)
      )
        globals.push(p);
    },
  });
  const removed: [number, number][] = [],
    remoteBindings = new Set<any>();
  const nativeBindingsCall = (specifier: string, exported: string[]) => {
    const bindings = Object.fromEntries(exported.map((name, index) => [index, name]));
    const origin = options.origin ? JSON.stringify(options.origin) : 'undefined';
    return `${bindingsName}(${JSON.stringify(specifier)},${origin},${JSON.stringify(bindings)})`;
  };
  const destructureBindings = (locals: string[], call: string) =>
    locals.length
      ? `const {${locals.map((local, index) => `${index}:${local}`).join(',')}}=${call};`
      : `${call};`;
  const bindingCall = (specifier: string, bindings: any[]) => {
    const exported = bindings.map((item) =>
      item.type === 'ImportDefaultSpecifier'
        ? 'default'
        : item.type === 'ImportNamespaceSpecifier'
          ? '*'
          : (item.imported.name ?? item.imported.value),
    );
    return destructureBindings(
      bindings.map((item) => item.local.name),
      nativeBindingsCall(specifier, exported),
    );
  };
  for (const p of moduleNodes) {
    const n = p.node,
      specifier = n.source?.value ?? n.arguments?.[0]?.value;
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
    if (!placement.native && n.type === 'ImportDeclaration' && placement.nativeExports?.length) {
      const nativeExports = new Set(placement.nativeExports);
      const selected = n.specifiers.filter((specifier: any) => {
        if (specifier.importKind === 'type') return false;
        if (specifier.type === 'ImportDefaultSpecifier') return nativeExports.has('default');
        if (specifier.type !== 'ImportSpecifier') return false;
        return nativeExports.has(specifier.imported.name ?? specifier.imported.value);
      });
      if (selected.length) {
        options.nativeSegment?.(specifier);
        used.add('nativeBindings');
        for (const item of selected) {
          const binding = p.scope.getBinding(item.local.name);
          if (binding) remoteBindings.add(binding);
        }
        const remaining = n.specifiers.filter((item: any) => !selected.includes(item));
        const imported = remaining.filter((item: any) => item.type === 'ImportSpecifier');
        const localImport = remaining.length
          ? `import ${[
              ...remaining
                .filter((item: any) => item.type === 'ImportDefaultSpecifier')
                .map((item: any) => item.local.name),
              ...remaining
                .filter((item: any) => item.type === 'ImportNamespaceSpecifier')
                .map((item: any) => `* as ${item.local.name}`),
              ...(imported.length
                ? [
                    `{${imported
                      .map((item: any) => {
                        const name = item.imported.name ?? item.imported.value;
                        const binding =
                          name === item.local.name ? name : `${name} as ${item.local.name}`;
                        return item.importKind === 'type' ? `type ${binding}` : binding;
                      })
                      .join(',')}}`,
                  ]
                : []),
            ].join(',')} from ${JSON.stringify(specifier)};`
          : '';
        const declarations = bindingCall(specifier, selected);
        edits.overwrite(n.start, n.end, localImport + declarations);
        removed.push([n.start, n.end]);
      }
      continue;
    }
    if (!placement.native) continue;
    options.nativeOrigin?.(specifier);
    const call = (mode?: string) =>
      `${nodeName}(${JSON.stringify(specifier)}${mode || options.origin ? ',' + JSON.stringify(mode ?? null) : ''}${options.origin ? ',' + JSON.stringify(options.origin) : ''})`;
    let replacement: string;
    if (n.type === 'ImportDeclaration') {
      const bindings = n.specifiers.filter((s: any) => s.importKind !== 'type');
      used.add('nativeBindings');
      for (const item of bindings) {
        const binding = p.scope.getBinding(item.local.name);
        if (binding) remoteBindings.add(binding);
      }
      replacement = bindingCall(specifier, bindings);
    } else if (n.type === 'ExportAllDeclaration') {
      const names = await options.names?.(specifier);
      if (!names) throw new Error(`Cannot determine native exports for ${specifier}`);
      used.add('nativeBindings');
      const locals: string[] = names.map(() => name());
      replacement =
        destructureBindings(locals, nativeBindingsCall(specifier, names)) +
        locals
          .map((local, index) => `export {${local} as ${JSON.stringify(names[index])}};`)
          .join('');
    } else if (n.type === 'ExportNamedDeclaration') {
      used.add('nativeBindings');
      const locals: string[] = n.specifiers.map(() => name());
      const exported = n.specifiers.map((s: any) =>
        s.type === 'ExportNamespaceSpecifier' ? '*' : (s.local.name ?? s.local.value),
      );
      replacement =
        destructureBindings(locals, nativeBindingsCall(specifier, exported)) +
        locals
          .map(
            (local, index) =>
              `export {${local} as ${n.specifiers[index].exported.name ?? JSON.stringify(n.specifiers[index].exported.value)}};`,
          )
          .join('');
    } else if (n.type === 'ImportExpression') {
      used.add('importNode');
      replacement = `${importName}(${JSON.stringify(specifier)}${options.origin ? ',' + JSON.stringify(options.origin) : ''})`;
    } else {
      used.add('nativeModule');
      const { end, keys } = extendRead(p);
      replacement = keys.length
        ? `${nodeName}(${JSON.stringify(specifier)},null,${JSON.stringify(options.origin ?? null)},${JSON.stringify(keys)})`
        : call();
      edits.overwrite(n.start, end.node.end, replacement);
      removed.push([n.start, end.node.end]);
      continue;
    }
    edits.overwrite(n.start, n.end, replacement);
    removed.push([n.start, n.end]);
  }

  // Runtime-selected modules are a capability of one expression, not a reason
  // to move the package containing that expression out of the browser.
  for (const p of dynamicRequires) {
    const n = p.node,
      argument = n.arguments[0];
    if (
      !argument ||
      argument.type === 'SpreadElement' ||
      removed.some(([start, end]) => n.start >= start && n.end <= end)
    )
      continue;
    used.add('nativeModule');
    options.nativeUsage?.();
    edits.overwrite(
      n.start,
      n.end,
      `${nodeName}(${edits.slice(argument.start, argument.end)},null,${JSON.stringify(options.origin ?? null)})`,
    );
    removed.push([n.start, n.end]);
  }

  const remoteExpression = (node: any, scope: any): boolean => {
    node = unwrapExpression(node);
    if (!node) return false;
    if (node.type === 'Identifier') return remoteBindings.has(scope.getBinding(node.name));
    if (node.type === 'MemberExpression') return remoteExpression(node.object, scope);
    if (node.type === 'CallExpression' || node.type === 'NewExpression')
      return remoteExpression(node.callee, scope);
    return false;
  };
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const variable of variables) {
      if (variable.node.id.type !== 'Identifier' || !variable.node.init) continue;
      const binding = variable.scope.getBinding(variable.node.id.name);
      if (
        binding?.constant &&
        !remoteBindings.has(binding) &&
        remoteExpression(variable.node.init, variable.scope)
      ) {
        remoteBindings.add(binding);
        discovered = true;
      }
    }
  }
  for (const p of calls) {
    const n = p.node;
    if (removed.some(([start, end]) => n.start >= start && n.end <= end)) continue;
    if (n.optional || n.callee.type !== 'MemberExpression' || n.callee.optional) continue;
    const key = staticKey(n.callee);
    if (
      key !== undefined &&
      n.callee.object.type === 'Identifier' &&
      remoteExpression(n.callee.object, p.scope) &&
      n.arguments.every(
        (argument: any) => argument.type !== 'SpreadElement' && stableArgument(argument),
      )
    ) {
      used.add('invokeMember');
      edits.appendLeft(n.callee.object.start, `${invokeName}(`);
      if (n.arguments.length)
        edits.overwrite(n.callee.object.end, n.arguments[0].start, `,${JSON.stringify(key)},`);
      else edits.overwrite(n.callee.object.end, n.end, `,${JSON.stringify(key)})`);
      removed.push([n.callee.start, n.callee.end]);
      continue;
    }
    if (
      key === undefined ||
      n.callee.object.type !== 'Identifier' ||
      !portableIntrinsics.has(n.callee.object.name) ||
      p.scope.getBinding(n.callee.object.name)
    )
      continue;
    const arguments_ = n.arguments.map((argument: any) =>
      argument.type === 'SpreadElement' ? undefined : nativeExpression(argument, p.scope),
    );
    if (
      arguments_.some((argument: any) => !argument) ||
      !arguments_.some((argument: any) => argument.native)
    )
      continue;
    used.add('evaluateIntrinsic');
    const path = [n.callee.object.name, key];
    const expression: NativeExpression = {
      kind: 'call',
      object: { kind: 'global', name: path[0]! },
      key,
      arguments: Object.fromEntries(
        arguments_.map((argument: any, index: number) => [index, argument.expression]),
      ),
    };
    edits.overwrite(
      n.start,
      n.end,
      `${evaluateName}(${edits.slice(n.callee.object.start, n.callee.object.end)},${edits.slice(n.callee.start, n.callee.end)},${JSON.stringify(path)},${JSON.stringify(expression)})`,
    );
    removed.push([n.start, n.end]);
  }
  for (const p of globals) {
    const n = p.node;
    if (removed.some(([start, end]) => n.start >= start && n.end <= end)) continue;
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
    } else {
      used.add('nativeGlobal');
      const { end, keys } = extendRead(p);
      replacement = `${nativeName}(${[n.name, ...keys].map((key) => JSON.stringify(key)).join(',')})`;
      if (keys.length) {
        edits.overwrite(n.start, end.node.end, replacement);
        removed.push([n.start, end.node.end]);
        continue;
      }
    }
    if (p.parent.type === 'ObjectProperty' && p.parent.shorthand && p.key === 'value')
      replacement = `${n.name}: ${replacement}`;
    edits.overwrite(n.start, n.end, replacement);
  }
  for (const p of members) {
    if (!valueRead(p) || staticKey(p.node) === undefined) continue;
    if (removed.some(([start, end]) => p.node.start >= start && p.node.end <= end)) continue;
    if (extendRead(p).keys.length) continue;
    const keys: string[] = [];
    let root = p;
    while (!removed.some(([start, end]) => root.node.start === start && root.node.end === end)) {
      const key = staticKey(root.node);
      if (key === undefined) break;
      keys.unshift(key);
      root = root.get('object');
    }
    if (keys.length < 2 || ['Super', 'MetaProperty'].includes(root.node.type)) continue;
    used.add('readPath');
    edits.overwrite(
      p.node.start,
      p.node.end,
      `${readName}(${edits.slice(root.node.start, root.node.end)},${keys.map((key) => JSON.stringify(key)).join(',')})`,
    );
  }
  if (!used.size) return null;
  const names: Record<string, string> = {
    nativeModule: nodeName,
    nativeBindings: bindingsName,
    importNode: importName,
    nativeGlobal: nativeName,
    hybridFetch: fetchName,
    HybridWebSocket: socketName,
    Buffer: bufferName,
    evaluateIntrinsic: evaluateName,
    invokeMember: invokeName,
  };
  if (used.delete('readPath')) {
    const access = JSON.stringify(options.access ?? 'lumiana/internal');
    imports.push(
      commonjs
        ? `const {readPath:${readName}}=require(${access});\n`
        : `import {readPath as ${readName}} from ${access};\n`,
    );
  }
  if (used.size)
    imports.push(
      `import {${[...used].map((key) => `${key} as ${names[key]}`).join(',')}} from ${JSON.stringify(options.client ?? 'lumiana/client')};\n`,
    );
  const prologue = ast.program.directives.at(-1)?.end ?? ast.program.interpreter?.end ?? 0;
  edits.appendLeft(prologue, (prologue ? '\n' : '') + imports.join(''));
  return {
    code: edits.toString(),
    map: edits.generateMap({ hires: true, source: id, includeContent: true }).toString(),
  };
}

/** Read the exports declared by one resolved file without executing it. */
export async function directExportNames(file: string): Promise<string[]> {
  const source = await fs.readFile(file, 'utf8'),
    names = new Set<string>();
  await Promise.all([initCJS(), initESM]);
  try {
    for (const item of parseESM(source)[1]) names.add(item.n);
  } catch {}
  try {
    for (const name of parseCJS(source).exports) names.add(name);
  } catch {}
  return [...names];
}

/** Use the same static export evidence as module loaders; never execute packages. */
export async function nativeExportNames(
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
    for (const name of await nativeExportNames(id, path.dirname(file), seen)) names.add(name);
  names.delete('default');
  names.delete('__esModule');
  return [...names].sort();
}
