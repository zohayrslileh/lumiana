import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Bundling, transformSource } from '../src/build.js';
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
test('bundling is the default; Node built-ins are not grounds for excluding a package', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-placement-'));
  try {
    const good = path.join(temp, 'good.js'),
      native = path.join(temp, 'native.cjs'),
      dynamic = path.join(temp, 'dynamic.cjs');
    await fs.writeFile(
      good,
      "import {readFileSync} from 'node:fs';export const read=readFileSync;export const add=(a,b)=>a+b;",
    );
    await fs.writeFile(native, "module.exports=require('./binding.node');");
    await fs.writeFile(path.join(temp, 'binding.node'), 'binary fixture');
    await fs.writeFile(dynamic, 'module.exports=name=>require(name);');
    const placement = new Bundling(temp, ['explicit']);
    assert.equal((await placement.placement('good', good)).native, false);
    assert.equal((await placement.placement('native', native)).native, true);
    assert.match((await placement.placement('dynamic', dynamic)).reason!, /Dynamic require/);
    assert.equal((await placement.placement('explicit', good)).native, true);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
