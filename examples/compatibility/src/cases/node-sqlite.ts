import { DatabaseSync } from 'node:sqlite';
import { assert } from '../check';

export async function run(output: HTMLElement) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE samples (id INTEGER PRIMARY KEY, label TEXT, bytes BLOB)');
    output.dataset.callbackContext = 'browser';
    db.function(
      'browser_label',
      (value: string) => `${value} from ${output.dataset.callbackContext}`,
    );
    const insert = db.prepare('INSERT INTO samples (label, bytes) VALUES (?, ?)');
    const bytes = new Uint8Array([0, 127, 128, 255]);
    insert.run('native SQLite', bytes);

    const row = db
      .prepare('SELECT browser_label(label) AS label, bytes FROM samples WHERE id = ?')
      .get(1);
    assert.equal(row.label, 'native SQLite from browser');
    assert.deepEqual([...row.bytes], [...bytes]);

    const tags = db.createTagStore();
    assert.equal(tags.get`SELECT count(*) AS count FROM samples`.count, 1);
    output.textContent =
      'node:sqlite: browser-owned statements and callbacks with native database handles.\n' +
      `${row.label}; BLOB bytes: ${[...row.bytes].join(', ')}`;
  } finally {
    db.close();
  }
}
