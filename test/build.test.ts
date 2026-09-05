import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Bundling, transformSource } from '../src/build.js';
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
    place: async () => ({ native: false }),
    client: new URL('../dist/client.js', import.meta.url).href,
    access: new URL('../dist/access.js', import.meta.url).href,
  });
  assert.ok(transformed);
  assert.match(transformed.code, /readPath as/);
  const load = (code: string) =>
    import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  assert.deepEqual((await load(transformed.code)).default(), (await load(source)).default());

  const global = await transformSource('export const home = process.env.HOME;', 'entry.js', {
    place: async () => ({ native: true }),
  });
  assert.match(global!.code, /from "node:process"/);
  assert.doesNotMatch(global!.code, /nativeGlobal as/);
  const intrinsic = await transformSource(
    'export const value = JSON.stringify(process.env);',
    'entry.js',
    { place: async () => ({ native: false }) },
  );
  assert.match(intrinsic!.code, /from "node:process"/);
  assert.doesNotMatch(intrinsic!.code, /evaluateIntrinsic as/);
  const module = await transformSource(
    "export const x = require('any-package').branch.value;",
    'entry.js',
    {
      place: async () => ({ native: true }),
    },
  );
  assert.match(module!.code, /\("any-package",null,null,\["branch","value"\]\)/);
  const metadata = 'export const mode = import.meta.env.MODE;';
  assert.equal(
    await transformSource(metadata, 'entry.js', { place: async () => ({ native: false }) }),
    null,
  );

  const cjs = await transformSource(
    "'use strict'; module.exports = function(value) { return { strict: this === undefined, value: value.child.value }; };",
    'reader.cjs',
    {
      place: async () => ({ native: false }),
    },
  );
  assert.ok(cjs);
  assert.ok(cjs.code.startsWith("'use strict';"));
  assert.ok(!cjs.code.includes('import {'));
  const exports = { exports: undefined as any };
  new Function('module', cjs.code)(exports);
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
      place: async () => ({ native: false }),
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
  assert.match(transformed.code, /nativeModule:__lumiana/);
});
test('scope-aware transforms preserve explicit browser access and local bindings', async () => {
  const source = `import fs from 'node:fs';import {readFile} from 'node:fs/promises';const native=fs.readFileSync('x');const same=fetch('/x');const remote=fetch('https://example.com');window.fetch('/explicit');new WebSocket('/socket');function shadow(fetch,WebSocket,process){fetch();new WebSocket();return process;}const fields={fetch,process};`;
  const transformed = await transformSource(source, 'entry.ts', {
    place: async (id) => ({ native: id.startsWith('node:') }),
  });
  assert.ok(transformed);
  assert.ok(!transformed.code.includes("from 'node:fs'"));
  assert.ok(transformed.code.includes("window.fetch('/explicit')"));
  assert.ok(
    transformed.code.includes(
      'function shadow(fetch,WebSocket,process){fetch();new WebSocket();return process;}',
    ),
  );
  assert.match(transformed.code, /fetch: __lumiana/);
  assert.match(transformed.code, /hybridFetch as/);
});
test('module placement receives the exports required by each static use', async () => {
  const requested: [string, string[]][] = [];
  await transformSource(
    "import {WebSocketServer as Server} from 'conditional-server';const Receiver=require('conditional-server').Receiver;void Server;void Receiver;",
    'entry.ts',
    {
      place: async (id, names = []) => {
        requested.push([id, names]);
        return { native: false };
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
      place: async (id) => ({ native: false, available: id !== 'optional-native' }),
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
      place: async () => ({ native: false }),
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
test('bundling is the default; Node built-ins are not grounds for excluding a package', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-placement-'));
  try {
    const good = path.join(temp, 'good.js'),
      native = path.join(temp, 'native.cjs'),
      dynamic = path.join(temp, 'dynamic.cjs'),
      data = path.join(temp, 'data.json');
    await fs.writeFile(
      good,
      "import {readFileSync} from 'node:fs';export const read=(file)=>readFileSync(file);export const add=(a,b)=>a+b;",
    );
    await fs.writeFile(native, "module.exports=require('./binding.node');");
    await fs.writeFile(path.join(temp, 'binding.node'), 'binary fixture');
    await fs.writeFile(dynamic, 'module.exports=name=>require(name);');
    await fs.writeFile(data, '{"value":42}');
    const placement = new Bundling(temp, ['explicit']);
    const goodPlacement = await placement.placement('good', good);
    assert.equal(goodPlacement.native, false);
    assert.equal((await placement.placement('native', native)).native, true);
    assert.equal((await placement.placement('dynamic', dynamic)).native, false);
    assert.equal((await placement.placement('data', data)).native, false);
    assert.equal((await placement.placement('explicit', good)).native, true);

    const transformed = await transformSource(
      "import {read,add} from 'good';export const values=[read,add(1,2)];",
      'entry.js',
      {
        place: async () => goodPlacement,
      },
    );
    assert.equal(transformed, null, 'bundlable package imports remain ordinary imports');

    const nativeApplication = await transformSource(
      "import create from 'native-package';const app=create();app.get('/',()=>42);app.listen(3000,()=>{});",
      'entry.js',
      { place: async () => ({ native: true }) },
    );
    assert.match(nativeApplication!.code, /\("native-package",undefined,\{"0":"default"\}\)/);
    assert.equal(nativeApplication!.code.match(/invokeMember as/g)?.length, 1);
    assert.equal(nativeApplication!.code.match(/__lumiana\d+\(app,"(?:get|listen)"/g)?.length, 2);
    const ordered = await transformSource(
      "import create from 'native-package';const app=create();app.get(argument());",
      'entry.js',
      { place: async () => ({ native: true }) },
    );
    assert.doesNotMatch(ordered!.code, /__lumiana\d+\(app,"get"/);

    let dynamicUsage = false;
    const dynamicModule = await transformSource(
      'module.exports=name=>require(name);',
      'dynamic.cjs',
      {
        place: async () => ({ native: false }),
        nativeUsage: () => (dynamicUsage = true),
        origin: 'dynamic.cjs',
      },
    );
    assert.equal(dynamicUsage, true);
    assert.match(dynamicModule!.code, /nativeModule:__lumiana/);
    assert.match(dynamicModule!.code, /\(name,null,"dynamic\.cjs"\)/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
