import Database from 'better-sqlite3';
import { Buffer } from 'node:buffer';
import { assert } from '../check';

export async function run(output: HTMLElement) {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT, data BLOB)');
    const insert = db.prepare('INSERT INTO notes (text, data) VALUES (?, ?)');
    const data = Buffer.from([0, 127, 128, 255]);
    db.transaction(() => {
      insert.run('DOM + SQLite — sample', data);
      insert.run('second row', data);
    })();
    const rows = db.prepare('SELECT * FROM notes ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, 'DOM + SQLite — sample');
    assert.deepEqual(Buffer.from(rows[0].data), data);
    assert.throws(
      db.transaction(() => {
        insert.run('rolled back', data);
        throw new Error('rollback');
      }),
      /rollback/,
    );
    assert.equal(db.prepare('SELECT count(*) AS count FROM notes').get().count, 2);
    output.textContent =
      'Native SQLite: prepared statements, binary BLOBs, commit and rollback.\n' +
      rows.map((row) => row.text).join('\n');
  } finally {
    db.close();
  }
}
