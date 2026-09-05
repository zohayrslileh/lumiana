import test from 'node:test';
import assert from 'node:assert/strict';
import { References } from '../src/references.js';
function pair() {
  const a = new References({
    sync: (input) => b.execute(input),
    async: async (input) => b.execute(input),
  });
  const b = new References({
    sync: (input) => a.execute(input),
    async: async (input) => a.execute(input),
  });
  return { a, b, remote: (value: any) => a.decode(b.encode(value)) };
}
test('plain graphs copy, native values retain identity and synchronous reflection', () => {
  const { a, b, remote } = pair();
  class Counter {
    value = 1;
    add(n: number) {
      this.value += n;
      return this;
    }
  }
  const original = new Counter(),
    copy = remote({ record: { a: 1 }, original });
  assert.equal(copy.original.value, 1);
  assert.equal(copy.original.add(2), copy.original);
  assert.equal(original.value, 3);
  copy.original.value = 4;
  assert.equal(original.value, 4);
  assert.equal(b.decode(a.encode(copy.original)), original);
  const Constructor = remote(Counter);
  assert.equal(new Constructor().value, 1);
  assert.ok(copy.original instanceof Constructor);
  const arr = remote([3, 1, 2]);
  assert.ok(Array.isArray(arr));
  assert.deepEqual([...arr.sort((x: number, y: number) => x - y)], [1, 2, 3]);
  assert.deepEqual(Object.keys(copy.original), ['value']);
  const cyc: any = {};
  cyc.self = cyc;
  const copied = remote(cyc);
  assert.equal(copied.self, copied);
  assert.notEqual(copied, cyc);
  const symbol = Symbol('x'),
    object = remote(new Map([[symbol, 5]]));
  assert.equal(object.get([...object.keys()][0]), 5);
  const binary = new Uint8Array([0, 255, 128]);
  assert.deepEqual(remote(binary), binary);
  const locked = remote(Object.freeze(new Counter()));
  assert.equal(Object.isFrozen(locked), true);
  assert.throws(() => {
    locked.value = 2;
  }, TypeError);
  const mutable = remote(new Counter());
  Object.freeze(mutable);
  assert.equal(Object.isFrozen(b.decode(a.encode(mutable))), true);
  const arrow = remote(() => 42);
  assert.throws(() => new arrow(), TypeError);
  const args = remote(
    (function () {
      return arguments;
    })(42),
  );
  assert.equal(args.length, 1);
  assert.equal(args[0], 42);
  class Bytes extends Uint8Array {
    first() {
      return this[0];
    }
  }
  assert.equal(remote(new Bytes([42])).first(), 42);
  a.close();
  assert.throws(() => copy.original.value, /disconnected/);
});
