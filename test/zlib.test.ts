import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { inflateRawSync } from 'node:zlib';
import * as zlib from '../src/runtime/zlib.js';

test('local compression supports explicit sync flush and interoperates with native inflate', async () => {
  const deflate = zlib.createDeflateRaw();
  const chunks: Buffer[] = [];
  deflate.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = once(deflate, 'end');
  const message = Buffer.from('compressed Unicode — sample 🌍');
  deflate.write(message);
  await new Promise<void>((resolve, reject) => {
    deflate.once('error', reject);
    deflate.flush(zlib.Z_SYNC_FLUSH, resolve);
  });
  assert.equal(zlib.Z_SYNC_FLUSH, zlib.constants.Z_SYNC_FLUSH);
  assert.ok(chunks.length > 0, 'flush produces bytes before ending the stream');
  deflate.end();
  await ended;
  assert.deepEqual(inflateRawSync(Buffer.concat(chunks)), message);
});
