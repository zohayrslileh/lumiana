import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { build } from 'vite';
import { lumiana } from '../dist/vite.js';

test('dependency cache identity follows the installed Lumiana transformer', async () => {
  const root = path.resolve('dist');
  const hash = createHash('sha256');
  const fingerprint = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) fingerprint(file);
      else if (entry.name.endsWith('.js'))
        hash.update(path.relative(root, file)).update(readFileSync(file));
    }
  };
  fingerprint(root);
  const expected = `lumiana-dependencies:${hash.digest('hex').slice(0, 12)}`;
  const configure = async (root: string) =>
    (await (lumiana().config as any).call({}, { root }, { command: 'serve', mode: 'development' }))
      .optimizeDeps;

  const vite6 = await configure(process.cwd());
  assert.equal(vite6.esbuildOptions.plugins[0].name, expected);

  const vite8 = await configure(path.resolve('examples/react'));
  assert.equal(vite8.rolldownOptions.plugins[0].name, expected);
});

test('the published browser client has no raw Node builtin dependency', async () => {
  const root = await fs.mkdtemp(path.join(process.cwd(), 'node_modules/.lumiana-client-build-'));
  try {
    const client = path.resolve('dist/client.js');
    await fs.writeFile(
      path.join(root, 'index.html'),
      '<script type="module" src="/main.js"></script>',
    );
    await fs.writeFile(
      path.join(root, 'main.js'),
      `import {lumiana} from ${JSON.stringify(client)};globalThis.instance=lumiana;`,
    );
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      build: { minify: false, target: 'esnext' },
    });
    const assets = path.join(root, 'dist/assets');
    const output = (
      await Promise.all(
        (await fs.readdir(assets)).map((file) => fs.readFile(path.join(assets, file), 'utf8')),
      )
    ).join('\n');
    assert.doesNotMatch(output, /__vite-browser-external/);
    assert.doesNotMatch(output, /node:buffer/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Vite keeps package JavaScript local and deploys only detected native addons', async (t) => {
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
    await pkg(
      'portable-buffer',
      {
        'index.js': "export const bufferProof=Buffer.from('buffer-proof').toString();",
      },
      { type: 'module' },
    );
    await pkg('portable-inheritance', {
      'index.js':
        "const {EventEmitter}=require('node:events');const {inherits}=require('node:util');function Boot(){this.setMaxListeners(0)}inherits(Boot,EventEmitter);module.exports=()=>new Boot() instanceof EventEmitter?'inheritance-proof':'broken';",
    });
    await pkg(
      'filesystem-library',
      {
        'index.js':
          "import {readFile} from 'node:fs/promises';export const filesystemProof='filesystem-runtime-proof';export const loadText=file=>readFile(file,'utf8');",
      },
      { type: 'module' },
    );
    await pkg('node-environment-library', {
      'index.js':
        "const assert=require('node:assert');const path=require('node:path');const process=require('node:process');const querystring=require('node:querystring');const {PassThrough}=require('node:stream');const nested=require('./nested');module.exports=()=>{assert.equal(path.join('a','b'),'a/b');assert.equal(querystring.stringify({a:1}),'a=1');const stream=new PassThrough();return process.browser&&stream instanceof PassThrough&&nested()?'node-environment-proof':'broken'};",
      'nested.js':
        "module.exports=()=>process.platform&&typeof setImmediate==='function'?'transitive-node-proof':'';",
    });
    await pkg(
      'socket-library',
      {
        'index.js':
          "import {createServer,Socket} from 'node:net';export const socketProof=typeof createServer==='function'&&typeof Socket==='function'?'socket-runtime-proof':'broken';",
      },
      { type: 'module' },
    );
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
    await pkg(
      'node-adapter',
      {
        'index.js':
          "import process from 'node:process';import server from 'universal-server';process.on('beforeExit',()=>{});export default server;",
      },
      { type: 'module' },
    );
    await pkg(
      'universal-server',
      {
        'browser.js': "export default 'service-worker-server';",
        'node.js': "export default 'node-condition-server';",
      },
      {
        type: 'module',
        exports: {
          browser: './browser.js',
          node: './node.js',
          default: './browser.js',
        },
      },
    );
    await pkg('native-addon', {
      'index.js': "module.exports=require('./binding.node');",
      'binding.node': 'binary native-proof',
    });
    await pkg('computed-native-addon', {
      'index.js':
        "const path=require('node:path');const select=()=>path.join(__dirname,'binding.node');module.exports=require(select());",
      'binding.node': 'computed binary native-proof',
    });
    await pkg(
      '@native/platform',
      {
        'loader.cjs': "module.exports=require('./binding.node');",
        'binding.node': 'transitive platform binary',
      },
      { exports: { './binding.node': './loader.cjs' } },
    );
    await pkg('native-wrapper', {
      'index.js': "module.exports=require('@native/platform/binding.node');",
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
      "import {value,tmpdir} from 'portable';import cjs from 'browser-cjs';import {bufferProof} from 'portable-buffer';import inheritance from 'portable-inheritance';import environment from 'node-environment-library';import {filesystemProof} from 'filesystem-library';import {socketProof} from 'socket-library';import condition from 'conditional';import {WebSocketServer} from 'conditional-server';import adapter from 'node-adapter';import addon from 'native-addon';import computedAddon from 'computed-native-addon';import wrappedAddon from 'native-wrapper';import explicit from 'explicit';export * from 'node:os';const server=new WebSocketServer();document.body.textContent=[value,tmpdir(),cjs(),bufferProof,inheritance(),environment(),filesystemProof,socketProof,condition,server.kind,adapter,addon,computedAddon,wrappedAddon,explicit].join(',');",
    );
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        lumiana({
          defaultCredentials: { username: 'build-user', password: 'build-password' },
        }),
      ],
      build: { minify: false, target: 'esnext' },
    });
    const assets = path.join(root, 'dist/client/assets');
    const output = (
      await Promise.all(
        (await fs.readdir(assets)).map((f) => fs.readFile(path.join(assets, f), 'utf8')),
      )
    ).join('\n');
    for (const text of [
      'bundled-proof',
      'cjs-proof',
      'buffer-proof',
      'inheritance-proof',
      'node-environment-proof',
      'transitive-node-proof',
      'filesystem-runtime-proof',
      'socket-runtime-proof',
      'browser-condition-proof',
      'node-condition-server',
      'node-server-proof',
      'explicit-proof',
    ])
      assert.ok(output.includes(text), text);
    assert.ok(!output.includes('service-worker-server'));
    assert.ok(!output.includes('"node:util"'));
    assert.doesNotMatch(output, /process\.platform\s*&&\s*typeof setImmediate/);
    for (const text of [
      'browser-client-proof',
      'binary native-proof',
      'computed binary native-proof',
      'transitive platform binary',
    ])
      assert.ok(!output.includes(text), text);
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/package.json'), 'utf8'));
    assert.equal(manifest.dependencies['native-addon'], '1.0.0');
    assert.equal(manifest.dependencies['computed-native-addon'], '1.0.0');
    assert.equal(manifest.dependencies['native-wrapper'], '1.0.0');
    assert.equal(manifest.dependencies['@native/platform'], undefined);
    assert.equal(manifest.dependencies.explicit, undefined);
    assert.equal(manifest.dependencies['conditional-server'], undefined);
    assert.equal(manifest.dependencies.portable, undefined);
    assert.equal(manifest.dependencies['filesystem-library'], undefined);
    assert.equal(manifest.dependencies['socket-library'], undefined);
    assert.equal(manifest.dependencies.conditional, undefined);
    assert.ok((await fs.stat(path.join(root, 'dist/server/worker.js'))).size > 0);
    const main = await fs.readFile(path.join(root, 'dist/main.mjs'), 'utf8');
    assert.ok(main.includes('username: process.env.LUMIANA_USERNAME ?? "build-user"'));
    assert.ok(main.includes('password: process.env.LUMIANA_PASSWORD ?? "build-password"'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
