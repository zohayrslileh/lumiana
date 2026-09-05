import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { lumiana } from '../dist/index.js';
test('Vite builds browser packages and deploys only proven or explicit native dependencies', async (t) => {
  const previous = [process.env.LUMIANA_USERNAME, process.env.LUMIANA_PASSWORD];
  t.after(() => {
    for (const [i, key] of ['LUMIANA_USERNAME', 'LUMIANA_PASSWORD'].entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  });
  process.env.LUMIANA_USERNAME = 'build-environment-user';
  process.env.LUMIANA_PASSWORD = 'build-environment-password';
  const root = await fs.mkdtemp(path.join(process.cwd(), 'node_modules/.lumiana-build-'));
  const pkg = async (name: string, files: Record<string, string>, extra = {}) => {
    const dir = path.join(root, 'node_modules', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...extra }),
    );
    for (const [file, source] of Object.entries(files))
      await fs.writeFile(path.join(dir, file), source);
  };
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await pkg(
      'portable',
      {
        'index.js':
          "import {tmpdir} from 'node:os';export const value='bundled-proof';export {tmpdir};",
      },
      { type: 'module' },
    );
    await pkg('browser-cjs', {
      'index.js': "module.exports=(value={deep:{value:'cjs-proof'}})=>value.deep.value;",
    });
    await pkg('portable-inheritance', {
      'index.js':
        "const {EventEmitter}=require('node:events');const {inherits}=require('node:util');function Boot(){this.setMaxListeners(0)}inherits(Boot,EventEmitter);module.exports=()=>new Boot() instanceof EventEmitter?'inheritance-proof':'broken';",
    });
    await pkg(
      'conditional',
      {
        'browser.js': "export default 'browser-condition-proof';",
        'index.js': "module.exports=require('./binding.node');",
        'binding.node': 'binary',
      },
      { exports: { browser: './browser.js', default: './index.js' } },
    );
    await pkg(
      'conditional-server',
      {
        'browser.js': "export const Client='browser-client-proof';",
        'node.js': "export class WebSocketServer{constructor(){this.kind='node-server-proof'}}",
      },
      {
        type: 'module',
        exports: { browser: './browser.js', import: './node.js', default: './node.js' },
      },
    );
    await pkg('native-addon', {
      'index.js': "module.exports=require('./binding.node');",
      'binding.node': 'binary native-proof',
    });
    await pkg('explicit', { 'index.js': "export default 'explicit-proof';" }, { type: 'module' });
    await fs.writeFile(
      path.join(root, 'index.html'),
      '<script type="module" src="/main.js"></script>',
    );
    await fs.writeFile(
      path.join(root, 'main.js'),
      "import {connect} from 'lumiana/client';await connect.credentials({username:'build-user',password:'build-password'});await import('./entry.js');",
    );
    await fs.writeFile(
      path.join(root, 'entry.js'),
      "import {value,tmpdir} from 'portable';import cjs from 'browser-cjs';import inheritance from 'portable-inheritance';import condition from 'conditional';import {WebSocketServer} from 'conditional-server';import addon from 'native-addon';import explicit from 'explicit';export * from 'node:os';const server=new WebSocketServer();document.body.textContent=[value,tmpdir(),cjs(),inheritance(),condition,server.kind,addon,explicit].join(',');",
    );
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        lumiana({
          defaultCredentials: { username: 'build-user', password: 'build-password' },
          nodeModules: ['explicit'],
        }),
      ],
      build: { minify: false, target: 'esnext' },
    });
    const assets = path.join(root, 'dist/public/assets');
    const output = (
      await Promise.all(
        (await fs.readdir(assets)).map((f) => fs.readFile(path.join(assets, f), 'utf8')),
      )
    ).join('\n');
    for (const text of [
      'bundled-proof',
      'cjs-proof',
      'inheritance-proof',
      'browser-condition-proof',
    ])
      assert.ok(output.includes(text), text);
    assert.ok(!output.includes('"node:util"'));
    for (const text of [
      'browser-client-proof',
      'node-server-proof',
      'binary native-proof',
      'explicit-proof',
    ])
      assert.ok(!output.includes(text), text);
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/package.json'), 'utf8'));
    assert.equal(manifest.dependencies['native-addon'], '1.0.0');
    assert.equal(manifest.dependencies.explicit, '1.0.0');
    assert.equal(manifest.dependencies['conditional-server'], '1.0.0');
    assert.equal(manifest.dependencies.portable, undefined);
    assert.equal(manifest.dependencies.conditional, undefined);
    assert.ok((await fs.stat(path.join(root, 'dist/server/worker.js'))).size > 0);
    const main = await fs.readFile(path.join(root, 'dist/main.mjs'), 'utf8');
    assert.ok(main.includes('username: process.env.LUMIANA_USERNAME ?? "build-user"'));
    assert.ok(main.includes('password: process.env.LUMIANA_PASSWORD ?? "build-password"'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
