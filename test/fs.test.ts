import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as runtime from '../dist/runtime/fs.js';
import promises from '../dist/runtime/fs-promises.js';
import { FileKernel } from '../src/kernel/files.js';
import { installKernel, removeKernel } from '../src/runtime/bridge.js';

test('filesystem named exports expose the same capabilities as the default export', () => {
  for (const name of ['Stats', 'Dirent', 'constants', 'promises'] as const) {
    assert.ok(name in runtime, `Missing named export: ${name}`);
    assert.equal(runtime[name], runtime.default[name]);
  }
});

test('built filesystem entry points preserve Stats and Dirent identity', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-fs-identity-'));
  const file = path.join(directory, 'file.txt');
  const kernel = new FileKernel();
  const owner = {};
  installKernel(
    owner,
    (operation, ...args) => kernel.execute(operation, args),
    (operation, ...args) => kernel.executeSync(operation, args),
  );
  const callback = (operation: Function, ...args: any[]) =>
    new Promise<any>((resolve, reject) =>
      operation(...args, (error: Error | null, value: any) =>
        error ? reject(error) : resolve(value),
      ),
    );
  try {
    await fs.writeFile(file, 'hello');
    const stats = [
      runtime.statSync(file),
      runtime.lstatSync(file),
      await callback(runtime.stat, file),
      await callback(runtime.lstat, file),
      await runtime.default.promises.stat(file),
      await promises.stat(file),
      await promises.lstat(file),
    ];
    const handle = await promises.open(file, 'r');
    try {
      stats.push(await handle.stat());
    } finally {
      await handle.close();
    }
    for (const stat of stats) {
      assert.ok(stat instanceof runtime.default.Stats);
      assert.equal(stat.isFile(), true);
      assert.equal(stat.size, 5);
    }
    const options = { withFileTypes: true };
    const listings = [
      runtime.readdirSync(directory, options),
      await callback(runtime.readdir, directory, options),
      await runtime.default.promises.readdir(directory, options),
      await promises.readdir(directory, options),
    ];
    for (const [entry] of listings) {
      assert.ok(entry instanceof runtime.default.Dirent);
      assert.equal(entry.name, 'file.txt');
      assert.equal(entry.isFile(), true);
    }
  } finally {
    removeKernel(owner);
    await kernel.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
