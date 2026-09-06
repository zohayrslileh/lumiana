import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  NativeAddons,
  moduleExportNames,
  requiresNodeResolution,
  transformSource,
} from '../src/build.js';

test('both Node builtin specifier forms establish Node execution provenance', () => {
  for (const source of [
    "const fs = require('fs');",
    "const fs = require('node:fs');",
    "import path from 'path';",
    "export * from 'node:util';",
  ])
    assert.equal(requiresNodeResolution(source), true, source);

  assert.equal(requiresNodeResolution("const utility = require('utility');"), false);
  for (const source of [
    'export const platform=process.platform;',
    'export const architecture=process.arch;',
    'export const directory=process.cwd();',
    'export const home=process.env.HOME;',
  ])
    assert.equal(requiresNodeResolution(source), true, source);
  assert.equal(requiresNodeResolution('export const mode=process.env.NODE_ENV;'), false);
  assert.equal(requiresNodeResolution("export const present=typeof process!=='undefined';"), false);
});
test('read-chain transforms preserve calls, writes, optional access and computed-key ordering', async () => {
  const source = `export default function () {
    const events = [];
    const leaf = { value: 1, method() { return this.value; }, tag() { return this.value; } };
    const root = { get branch() { events.push('branch'); return { leaf }; } };
    const key = () => { events.push('key'); return 'leaf'; };
    const read = root.branch.leaf.value;
    const computed = root.branch[key()].value;
    const called = root.branch.leaf.method();
    const tagged = root.branch.leaf.tag\`text\`;
    root.branch.leaf.value = 2;
    root.branch.leaf.value++;
    ({ value: root.branch.leaf.value } = { value: 4 });
    [root.branch.leaf.value] = [5];
    for (root.branch.leaf.value of [6]) {}
    const optional = root.branch.leaf?.method?.();
    const missing = null;
    const skipped = missing?.branch.leaf.value;
    delete root.branch.leaf.value;
    return { read, computed, called, tagged, optional, skipped, events, deleted: !('value' in leaf) };
  }`;
  const transformed = await transformSource(source, 'reader.js', {
    place: async () => ({}),
  });
  assert.equal(transformed, null, 'local property reads require no transform');

  const global = await transformSource('export const home = process.env.HOME;', 'entry.js', {
    place: async () => ({}),
  });
  assert.match(global!.code, /from "node:process"/);
  assert.doesNotMatch(global!.code, /nativeGlobal as/);
  const intrinsic = await transformSource(
    'export const value = JSON.stringify(process.env);',
    'entry.js',
    { place: async () => ({}) },
  );
  assert.match(intrinsic!.code, /from "node:process"/);
  assert.doesNotMatch(intrinsic!.code, /evaluateIntrinsic as/);
  const module = await transformSource(
    "export const x = require('any-package').branch.value;",
    'entry.js',
    {
      place: async () => ({}),
    },
  );
  assert.equal(module, null, 'package requires remain local');
  const metadata = 'export const mode = import.meta.env.MODE;';
  assert.equal(await transformSource(metadata, 'entry.js', { place: async () => ({}) }), null);

  const cjsSource =
    "'use strict'; module.exports = function(value) { return { strict: this === undefined, value: value.child.value }; };";
  const cjs = await transformSource(cjsSource, 'reader.cjs', {
    place: async () => ({}),
  });
  assert.equal(cjs, null);
  const exports = { exports: undefined as any };
  new Function('module', cjsSource)(exports);
  assert.deepEqual(exports.exports.call(undefined, { child: { value: 8 } }), {
    strict: true,
    value: 8,
  });
});
test('CommonJS transforms preserve the CommonJS module contract', async () => {
  const transformed = await transformSource(
    "'use strict';module.exports=(name)=>{setImmediate(()=>{});return [process.env,Buffer.from('x'),require(name)]};",
    'runtime.cjs',
    {
      place: async () => ({}),
      origin: 'node_modules/runtime/runtime.cjs',
    },
  );
  assert.ok(transformed);
  assert.ok(transformed.code.startsWith("'use strict';"));
  assert.doesNotMatch(transformed.code, /(^|[;\n])\s*import\s/m);
  assert.doesNotMatch(
    transformed.code,
    /require\("(?:node:process|node:timers|lumiana\/client)"\)/,
  );
  assert.match(transformed.code, /Symbol\.for\("lumiana\.runtime"\)/);
  assert.match(transformed.code, /process:__lumiana/);
  assert.match(transformed.code, /setImmediate:__lumiana/);
  assert.match(transformed.code, /require\(name\)/);
});
test('scope-aware transforms preserve explicit browser access and local bindings', async () => {
  const source = `import fs from 'node:fs';import {readFile} from 'node:fs/promises';const native=fs.readFileSync('x');const same=fetch('/x');const remote=fetch('https://example.com');window.fetch('/explicit');new WebSocket('/socket');function shadow(fetch,WebSocket,process){fetch();new WebSocket();return process;}const fields={fetch,process};`;
  const transformed = await transformSource(source, 'entry.ts', {
    place: async () => ({}),
  });
  assert.ok(transformed);
  assert.ok(transformed.code.includes("from 'node:fs'"));
  assert.ok(transformed.code.includes("window.fetch('/explicit')"));
  assert.ok(
    transformed.code.includes(
      'function shadow(fetch,WebSocket,process){fetch();new WebSocket();return process;}',
    ),
  );
  assert.match(transformed.code, /fetch: __lumiana/);
  assert.match(transformed.code, /hybridFetch as/);
});
test('dependency environment probes remain owned by Vite and the browser', async () => {
  for (const source of [
    "module.exports=process.env.NODE_ENV==='production'?'production':'development';",
    "const schedule=typeof setImmediate==='function'?setImmediate:queueMicrotask;module.exports=schedule;",
  ])
    assert.equal(
      await transformSource(source, 'node_modules/dependency/index.js', {
        place: async () => ({}),
        nodeGlobals: false,
      }),
      null,
    );

  assert.equal(
    await transformSource('export const mode=process.env.NODE_ENV;', 'src/application.ts', {
      place: async () => ({}),
    }),
    null,
    'Vite owns its NODE_ENV replacement in application modules too',
  );

  const globalAlias = await transformSource(
    'module.exports = global.crypto && global.queueMicrotask;',
    'node_modules/dependency/browser.js',
    {
      place: async () => ({}),
      nodeGlobals: false,
    },
  );
  assert.match(globalAlias!.code, /nodeGlobal:__lumiana/);
  assert.match(globalAlias!.code, /globalThis\[Symbol\.for\("lumiana\.runtime"\)\]/);
  const realm = { crypto: {}, queueMicrotask() {} };
  const module = { exports: undefined };
  new Function('module', 'globalThis', globalAlias!.code)(module, {
    [Symbol.for('lumiana.runtime')]: { nodeGlobal: realm },
  });
  assert.equal(module.exports, realm.queueMicrotask);

  const concreteGlobals = await transformSource(
    'export const input = value => Buffer.isBuffer(value);export const here=__filename;',
    'node_modules/dependency/browser.js',
    {
      place: async () => ({}),
      nodeGlobals: false,
      origin: 'node_modules/dependency/browser.js',
    },
  );
  assert.match(concreteGlobals!.code, /Buffer as __lumiana/);
  assert.match(concreteGlobals!.code, /moduleFilename as __lumiana/);
  assert.doesNotMatch(concreteGlobals!.code, /\bBuffer\.isBuffer/);
  assert.doesNotMatch(concreteGlobals!.code, /\b__filename\b/);
});
test('module export evidence follows export-all edges', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-exports-'));
  try {
    const entry = path.join(root, 'entry.js');
    await fs.writeFile(entry, "export * from './runtime.js';export const direct=true;");
    await fs.writeFile(path.join(root, 'runtime.js'), 'export const transitive=true;');
    const names = await moduleExportNames(entry, async (id, importer) =>
      id.startsWith('.') ? path.resolve(path.dirname(importer), id) : undefined,
    );
    assert.deepEqual(names, ['direct', 'transitive']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('module placement receives the exports required by each static use', async () => {
  const requested: [string, string[]][] = [];
  await transformSource(
    "import {WebSocketServer as Server} from 'conditional-server';const Receiver=require('conditional-server').Receiver;void Server;void Receiver;",
    'entry.ts',
    {
      place: async (id, names = []) => {
        requested.push([id, names]);
        return {};
      },
    },
  );
  assert.deepEqual(requested, [
    ['conditional-server', ['WebSocketServer']],
    ['conditional-server', ['Receiver']],
  ]);
});
test('createRequire records unavailable static dependencies at build time', async () => {
  const transformed = await transformSource(
    "import {createRequire as makeRequire} from 'node:module';const require=makeRequire(import.meta.url);try{require(`optional-native`)}catch{};process.on('exit',()=>{});",
    'package.js',
    {
      origin: 'node_modules/package/index.js',
      place: async (id) => ({ available: id !== 'optional-native' }),
    },
  );
  assert.match(
    transformed!.code,
    /makeRequire\(import\.meta\.url,"node_modules\/package\/index\.js",\["optional-native"\]\)/,
  );
});
test('Node file URL conversion receives the native source module location', async () => {
  const sourceURL = 'file:///workspace/src/entry.ts';
  const transformed = await transformSource(
    `import {fileURLToPath as toPath} from 'node:url';
import * as url from 'node:url';
import urlDefault from 'node:url';
const direct=toPath(import.meta.url);
const relative=url.fileURLToPath(new URL('../data', import.meta.url));
const defaultImport=urlDefault.fileURLToPath(import.meta.url);
const browserURL=import.meta.url;
function untouched(fileURLToPath){return fileURLToPath(import.meta.url)}`,
    '/workspace/src/entry.ts',
    {
      sourceURL,
      place: async () => ({}),
    },
  );
  assert.ok(transformed);
  assert.match(transformed.code, /toPath\("file:\/\/\/workspace\/src\/entry\.ts"\)/);
  assert.match(
    transformed.code,
    /url\.fileURLToPath\(new URL\('\.\.\/data', "file:\/\/\/workspace\/src\/entry\.ts"\)\)/,
  );
  assert.match(transformed.code, /const browserURL=import\.meta\.url/);
  assert.match(
    transformed.code,
    /urlDefault\.fileURLToPath\("file:\/\/\/workspace\/src\/entry\.ts"\)/,
  );
  assert.match(
    transformed.code,
    /function untouched\(fileURLToPath\)\{return fileURLToPath\(import\.meta\.url\)\}/,
  );
});
test('CommonJS module metadata resolves from its logical source origin', async () => {
  const transformed = await transformSource(
    'module.exports={file:__filename,directory:__dirname};',
    '/workspace/node_modules/package/index.cjs',
    {
      origin: 'node_modules/package/index.cjs',
      sourceURL: 'file:///workspace/node_modules/package/index.cjs',
      place: async () => ({}),
    },
  );
  assert.match(transformed!.code, /moduleFilename:__lumiana/);
  assert.match(transformed!.code, /__lumiana\d+\("node_modules\/package\/index\.cjs"\)/);
  assert.match(transformed!.code, /moduleDirname:__lumiana/);
  assert.doesNotMatch(transformed!.code, /\b__filename\b|\b__dirname\b/);
});
test('packages remain local and native-addon ownership is tracked independently', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-placement-'));
  try {
    const packageRoot = path.join(temp, 'node_modules', 'native-package');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'native-package', version: '2.0.0' }),
    );
    await fs.writeFile(path.join(packageRoot, 'binding.node'), 'binary fixture');
    await fs.mkdir(path.join(packageRoot, 'prebuilds'));
    await fs.writeFile(
      path.join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}.node`),
      'platform binary fixture',
    );
    const addons = new NativeAddons(temp);
    assert.deepEqual(await addons.dependencies(), {});
    assert.equal(
      addons.addon(path.join(packageRoot, 'binding.node')),
      'native-package/binding.node',
    );
    assert.equal(
      await addons.locate('binding.node', path.join(packageRoot, 'loader.cjs')),
      'native-package/binding.node',
    );
    assert.equal(
      await addons.locate('computed-name.node', path.join(packageRoot, 'loader.cjs')),
      undefined,
      'a literal addon request must resolve exactly',
    );
    assert.equal(
      await addons.locate('computed-name.node', path.join(packageRoot, 'loader.cjs'), true),
      `native-package/prebuilds/${process.platform}-${process.arch}.node`,
    );
    assert.deepEqual(await addons.dependencies(), { 'native-package': '2.0.0' });

    const exportedRoot = path.join(temp, 'node_modules', 'exported-native-package');
    await fs.mkdir(path.join(exportedRoot, 'lib'), { recursive: true });
    await fs.writeFile(
      path.join(exportedRoot, 'package.json'),
      JSON.stringify({
        name: 'exported-native-package',
        version: '3.0.0',
        exports: { './binding.node': './loader.cjs' },
      }),
    );
    await fs.writeFile(
      path.join(exportedRoot, 'loader.cjs'),
      "module.exports=require('./lib/binding.node')",
    );
    await fs.writeFile(path.join(exportedRoot, 'lib/binding.node'), 'binary fixture');
    assert.equal(
      await addons.locate('exported-native-package/binding.node', path.join(temp, 'entry.mjs')),
      'exported-native-package/binding.node',
      'a .node package export keeps its public identity while tracking the native loader',
    );

    const libraryRoot = path.join(temp, 'node_modules', 'image-library');
    const platformRoot = path.join(temp, 'node_modules', '@native', 'platform');
    await fs.mkdir(libraryRoot, { recursive: true });
    await fs.mkdir(platformRoot, { recursive: true });
    await fs.writeFile(
      path.join(libraryRoot, 'package.json'),
      JSON.stringify({ name: 'image-library', version: '4.0.0' }),
    );
    await fs.writeFile(
      path.join(platformRoot, 'package.json'),
      JSON.stringify({
        name: '@native/platform',
        version: '1.0.0',
        exports: { './binding.node': './loader.cjs' },
      }),
    );
    await fs.writeFile(
      path.join(platformRoot, 'loader.cjs'),
      "module.exports=require('./binding.node')",
    );
    await fs.writeFile(path.join(platformRoot, 'binding.node'), 'platform binary fixture');
    const boundary = new NativeAddons(temp);
    assert.equal(
      await boundary.locate(
        '@native/platform/binding.node',
        path.join(libraryRoot, 'native-loader.cjs'),
      ),
      '@native/platform/binding.node',
    );
    assert.deepEqual(
      await boundary.dependencies(),
      { 'image-library': '4.0.0' },
      'the JavaScript package at the native boundary owns the deployed dependency',
    );

    const contextualAddon = await transformSource(
      "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);export const load=()=>require('native-package/binding.node');",
      path.join(temp, 'entry.mjs'),
      {
        origin: 'entry.mjs',
        locateAddon: (request, computed) =>
          addons.locate(request, path.join(temp, 'entry.mjs'), computed),
        place: async () => ({}),
      },
    );
    assert.match(contextualAddon!.code, /nativeAddon as __lumiana/);
    assert.match(
      contextualAddon!.code,
      /__lumiana\d+\("native-package\/binding\.node","entry\.mjs"\)/,
    );
    assert.doesNotMatch(contextualAddon!.code, /require\('native-package\/binding\.node'\)/);

    const located = await transformSource(
      "module.exports=require('addon-locator')('binding.node');",
      path.join(packageRoot, 'loader.cjs'),
      {
        origin: 'node_modules/native-package/loader.cjs',
        locateAddon: (request) => addons.locate(request, path.join(packageRoot, 'loader.cjs')),
        place: async () => ({}),
      },
    );
    assert.match(located!.code, /nativeAddon:__lumiana/);
    assert.match(
      located!.code,
      /\("native-package\/binding\.node","node_modules\/native-package\/loader\.cjs"\)/,
    );
    assert.doesNotMatch(located!.code, /addon-locator/);

    const computed = await transformSource(
      "const path=require('path');let file=path.join(__dirname,'binding.node');module.exports=require(file);",
      path.join(packageRoot, 'computed-loader.cjs'),
      {
        origin: 'node_modules/native-package/computed-loader.cjs',
        locateAddon: (request, computed) =>
          addons.locate(request, path.join(packageRoot, 'computed-loader.cjs'), computed),
        place: async () => ({}),
      },
    );
    assert.match(computed!.code, /nativeAddon:__lumiana/);
    assert.match(
      computed!.code,
      /specifier=>__lumiana\d+\(specifier,"node_modules\/native-package\/computed-loader\.cjs"\)\)\(file\)/,
    );
    assert.doesNotMatch(computed!.code, /require\(file\)/);

    const concatenated = await transformSource(
      "module.exports=name=>require('./prebuilds/'+process.platform+'-'+process.arch+'/'+name+'.node');",
      path.join(packageRoot, 'concatenated-loader.cjs'),
      {
        origin: 'node_modules/native-package/concatenated-loader.cjs',
        locateAddon: (request, computed) =>
          addons.locate(request, path.join(packageRoot, 'concatenated-loader.cjs'), computed),
        place: async () => ({}),
      },
    );
    assert.match(concatenated!.code, /nativeAddon:__lumiana/);
    assert.match(
      concatenated!.code,
      /specifier,"node_modules\/native-package\/concatenated-loader\.cjs"/,
    );
    assert.match(concatenated!.code, /name\+'\.node'\)/);

    const transformed = await transformSource(
      "import {read,add} from 'good';export const values=[read,add(1,2)];",
      'entry.js',
      {
        place: async () => ({}),
      },
    );
    assert.equal(transformed, null, 'bundlable package imports remain ordinary imports');

    const nativeApplication = await transformSource(
      "import create from 'native-package';const app=create();app.get('/',()=>42);app.listen(3000,()=>{});",
      'entry.js',
      { place: async () => ({}) },
    );
    assert.equal(nativeApplication, null, 'application objects stay in the browser');

    const dynamicModule = await transformSource(
      'module.exports=name=>require(name);',
      'dynamic.cjs',
      {
        place: async () => ({}),
        origin: 'dynamic.cjs',
      },
    );
    assert.equal(dynamicModule, null, 'dynamic loading is not redirected to the Worker');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
