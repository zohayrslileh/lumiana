import test from 'node:test';
import assert from 'node:assert/strict';
import native from 'node:path';
import path, { posix, win32, sep, delimiter } from '../src/runtime/path.js';
import { initializeProcess } from '../src/runtime/process.js';

test('local paths preserve POSIX and Windows contracts, including connection cwd', () => {
  initializeProcess({ ...process, env: {}, cwd: process.cwd() });
  assert.equal(posix.resolve('nested', '..', 'file'), native.posix.resolve('nested', '..', 'file'));
  for (const [local, original, paths] of [
    [posix, native.posix, ['/a/../b/c.txt', '//a/b/', '/.hidden', '/']],
    [win32, native.win32, ['C:\\a\\..\\b\\c.txt', '\\\\server\\share\\file', 'D:\\', 'C:relative']],
  ] as const) {
    for (const value of paths) {
      assert.equal(local.normalize(value), original.normalize(value));
      assert.deepEqual(local.parse(value), original.parse(value));
      assert.equal(local.format(local.parse(value)), original.format(original.parse(value)));
      assert.equal(local.isAbsolute(value), original.isAbsolute(value));
    }
  }
  initializeProcess({
    ...process,
    platform: 'win32',
    env: { '=D:': 'D:\\elsewhere' },
    cwd: 'C:\\work\\project',
  });
  assert.equal(path.resolve('nested', '..', 'file'), 'C:\\work\\project\\file');
  assert.equal(win32.resolve('D:note.txt'), 'D:\\elsewhere\\note.txt');
  assert.equal(win32.relative('a', 'b'), '..\\b');
  assert.equal(sep, '\\');
  assert.equal(delimiter, ';');
  assert.equal(win32.toNamespacedPath('file'), '\\\\?\\C:\\work\\project\\file');
  initializeProcess({ ...process, env: {}, cwd: process.cwd() });
});
