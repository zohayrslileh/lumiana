import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as runtime from '../dist/runtime/fs.js';
import promises from '../dist/runtime/fs-promises.js';
import { FileKernel } from '../src/kernel/files.js';
import { installKernel, removeKernel } from '../src/runtime/bridge.js';
import { encode, decode } from '@msgpack/msgpack';

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

test('filesystem reads mutate caller-owned buffers and preserve callback identity across serialization', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumiana-fs-buffers-'));
  const file = path.join(directory, 'bytes');
  const kernel = new FileKernel();
  const owner = {};
  const transfer = (value: any): any => decode(encode(value));
  installKernel(
    owner,
    async (operation, ...args) => transfer(await kernel.execute(operation, transfer(args))),
    (operation, ...args) => transfer(kernel.executeSync(operation, transfer(args))),
  );
  const callback = (operation: Function, ...args: any[]) =>
    new Promise<any[]>((resolve, reject) =>
      operation(...args, (error: Error | null, ...values: any[]) =>
        error ? reject(error) : resolve(values),
      ),
    );
  let fd: number | undefined;
  try {
    await fs.writeFile(file, Buffer.from([1, 2, 128, 255]));
    fd = runtime.openSync(file, 'r+');
    const target = Buffer.alloc(8, 42).subarray(2, 7);
    const [count, returned] = await callback(runtime.read, fd, target, 1, 3, 1);
    assert.equal(count, 3);
    assert.equal(returned, target);
    assert.deepEqual([...target], [42, 2, 128, 255, 42]);
    const sync = new Uint8Array(6).fill(42);
    assert.equal(runtime.readSync(fd, sync, { offset: 2, length: 4, position: 0 }), 4);
    assert.deepEqual([...sync], [42, 42, 1, 2, 128, 255]);
    const vectors = [new Uint8Array(2), new Uint8Array(4).fill(42)];
    const [read, original] = await callback(runtime.readv, fd, vectors, 0);
    assert.equal(read, 4);
    assert.equal(original, vectors);
    assert.deepEqual(
      vectors.map((value) => [...value]),
      [
        [1, 2],
        [128, 255, 42, 42],
      ],
    );
    vectors.forEach((value) => value.fill(0));
    assert.equal(runtime.readvSync(fd, vectors, 0), 4);
    assert.deepEqual(
      vectors.map((value) => [...value]),
      [
        [1, 2],
        [128, 255, 0, 0],
      ],
    );
    const data = Buffer.from('text');
    assert.equal((await callback(runtime.write, fd, data, 0, data.length, 0))[1], data);
    const [optionCount, optionBuffer] = await callback(runtime.read, fd, {
      buffer: target,
      offset: 1,
      length: 4,
      position: 0,
    });
    assert.equal(optionCount, 4);
    assert.equal(optionBuffer, target);
    assert.equal(target.subarray(1).toString(), 'text');
  } finally {
    if (fd !== undefined) runtime.closeSync(fd);
    removeKernel(owner);
    await kernel.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
