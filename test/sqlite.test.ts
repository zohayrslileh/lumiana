import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync as NativeDatabaseSync } from 'node:sqlite';
import { installKernel, removeKernel } from '../src/runtime/bridge.js';
import { backup, constants, DatabaseSync, Session, StatementSync } from '../src/runtime/sqlite.js';
import sqlite from '../src/runtime/sqlite.js';
import { SQLiteKernel } from '../src/kernel/sqlite.js';
import { decodeValue, encodeValue } from '../src/values.js';

function realm() {
  let sequence = 0;
  let callbackSequence = 0;
  const callbacks = new Map<number, Function>();
  const copy = (value: any) => decodeValue(encodeValue(value));
  const kernel = new SQLiteKernel(() => ++sequence, {
    sync: (id, args) => copy(callbacks.get(id)!(...copy(args))),
    async: async (id, args) => copy(await callbacks.get(id)!(...copy(args))),
  });
  const owner = {};
  installKernel(
    owner,
    async (operation, ...args) => copy(await kernel.execute(operation, copy(args))),
    (operation, ...args) => copy(kernel.executeSync(operation, copy(args))),
    (callback) => {
      const id = ++callbackSequence;
      callbacks.set(id, callback);
      return id;
    },
  );
  return {
    close() {
      kernel.close();
      removeKernel(owner);
    },
  };
}

test('node:sqlite preserves statements, binary values and incremental iteration', () => {
  const runtime = realm();
  try {
    assert.throws(() => new StatementSync(), { code: 'ERR_ILLEGAL_CONSTRUCTOR' });
    assert.throws(() => new Session(), { code: 'ERR_ILLEGAL_CONSTRUCTOR' });
    assert.equal(sqlite.DatabaseSync, DatabaseSync);

    const unopened = new DatabaseSync(':memory:', { open: false });
    assert.equal(unopened.isOpen, false);
    unopened.open();
    unopened.close();

    const db = new DatabaseSync(':memory:');
    assert.equal(db.isOpen, true);
    assert.equal(db.isTransaction, false);
    assert.equal(db.location(), null);
    const variableLimit = db.limits.variableNumber;
    db.limits.variableNumber = 100;
    assert.equal(db.limits.variableNumber, 100);
    db.limits.variableNumber = variableLimit;
    db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT, bytes BLOB)');
    const insert = db.prepare('INSERT INTO records (label, bytes) VALUES (?, ?)');
    assert.ok(insert instanceof StatementSync);
    assert.equal(insert.sourceSQL, 'INSERT INTO records (label, bytes) VALUES (?, ?)');
    const bytes = new Uint8Array([0, 127, 128, 255]);
    assert.deepEqual(insert.run('first', bytes), { changes: 1, lastInsertRowid: 1 });
    insert.run('second', bytes.subarray(1));
    assert.match(insert.expandedSQL, /second/);

    const select = db.prepare('SELECT id, label, bytes FROM records ORDER BY id');
    assert.equal(select.columns()[1]?.name, 'label');
    const iterator = select.iterate();
    const first = iterator.next();
    assert.equal(first.done, false);
    assert.equal(first.value.label, 'first');
    assert.deepEqual([...first.value.bytes], [0, 127, 128, 255]);
    assert.equal(iterator.next().value.label, 'second');
    assert.equal(iterator.next().done, true);

    select.setReadBigInts(true);
    select.setReturnArrays(true);
    assert.equal(select.get()[0], 1n);
    db.close();
    assert.equal(db.isOpen, false);
    db.open();
    assert.equal(db.isOpen, true);
    db.close();
  } finally {
    runtime.close();
  }
});

test('node:sqlite callbacks remain browser functions', () => {
  const runtime = realm();
  try {
    const db = new DatabaseSync(':memory:');
    const calls: string[] = [];
    db.function('browser_upper', { deterministic: true }, (value: string) => {
      calls.push(value);
      return value.toUpperCase();
    });
    assert.equal(db.prepare("SELECT browser_upper('local') AS value").get().value, 'LOCAL');
    assert.deepEqual(calls, ['local']);

    db.exec('CREATE TABLE numbers (value INTEGER); INSERT INTO numbers VALUES (2), (3), (4)');
    db.aggregate('product', {
      start: () => 1,
      step: (total: number, value: number) => total * value,
    });
    assert.equal(db.prepare('SELECT product(value) AS value FROM numbers').get().value, 24);
    assert.equal(Object.prototype.propertyIsEnumerable.call(db, 'isOpen'), true);
    assert.equal(
      Object.prototype.propertyIsEnumerable.call(DatabaseSync.prototype, 'prepare'),
      true,
    );
    assert.equal(Object.isFrozen(constants), false);
    assert.equal(Object.getOwnPropertyDescriptor(constants, 'SQLITE_OK')?.writable, false);

    let reads = 0;
    db.setAuthorizer((action: number) => {
      if (action === constants.SQLITE_READ) reads++;
      return constants.SQLITE_OK;
    });
    db.prepare('SELECT value FROM numbers').all();
    assert.ok(reads > 0);
    db.setAuthorizer(null);
    db.close();
  } finally {
    runtime.close();
  }
});

test('node:sqlite sessions, serialization and browser-owned tag cache compose', () => {
  const runtime = realm();
  try {
    const source = new DatabaseSync(':memory:');
    source.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    const session = source.createSession();
    source.exec("INSERT INTO items VALUES (1, 'one')");
    const changeset = session.changeset();
    assert.ok(changeset.byteLength > 0);

    const target = new DatabaseSync(':memory:');
    target.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    let filteredInBrowser = false;
    assert.equal(
      target.applyChangeset(changeset, {
        filter(table: string) {
          filteredInBrowser = true;
          return table === 'items';
        },
      }),
      true,
    );
    assert.equal(filteredInBrowser, true);
    assert.equal(target.prepare('SELECT name FROM items').get().name, 'one');

    const tags = target.createTagStore(2);
    assert.throws(() => new tags.constructor(), { code: 'ERR_ILLEGAL_CONSTRUCTOR' });
    assert.equal(tags.db, target);
    assert.equal(tags.get`SELECT name FROM items WHERE id = ${1}`.name, 'one');
    assert.equal(tags.size, 1);
    tags.all`SELECT name FROM items WHERE id > ${0}`;
    assert.equal(tags.size, 2);
    tags.get`SELECT count(*) AS count FROM items`;
    assert.equal(tags.size, 2);
    tags.clear();
    assert.equal(tags.size, 0);

    const serialized = target.serialize();
    const restored = new DatabaseSync(':memory:');
    restored.deserialize(serialized);
    assert.equal(restored.prepare('SELECT name FROM items').get().name, 'one');
    session.close();
    source.close();
    target.close();
    restored.close();
  } finally {
    runtime.close();
  }
});

test('node:sqlite backup copies a database without text encoding', async () => {
  const runtime = realm();
  const directory = await mkdtemp(path.join(tmpdir(), 'lumiana-sqlite-'));
  const destination = path.join(directory, 'copy.db');
  try {
    const source = new DatabaseSync(':memory:');
    source.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('copied')");
    const progress: number[] = [];
    const pages = await backup(source, destination, {
      rate: 1,
      progress({ totalPages }: { totalPages: number }) {
        progress.push(totalPages);
      },
    });
    assert.ok(pages >= 0);
    assert.ok((await readFile(destination)).byteLength > 0);
    assert.ok(progress.length > 0);
    const copied = new NativeDatabaseSync(destination);
    assert.equal(copied.prepare('SELECT value FROM sample').get()!.value, 'copied');
    copied.close();
    source.close();
  } finally {
    runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
