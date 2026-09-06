import { parse } from 'csv-parse';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const folder = await mkdtemp(join(tmpdir(), 'lumiana-csv-'));
  try {
    const file = join(folder, 'notes.csv');
    await writeFile(file, 'name,note\r\nExample,"Hello, sample 🌍"\r\nBrowser,"two\nlines"\r\n');
    const source = createReadStream(file, { highWaterMark: 3 });
    const parser = parse({ columns: true });
    const rows: unknown[] = [];
    const ended = once(parser, 'end');
    source.on('error', (error) => parser.destroy(error));
    parser.on('data', (row) => rows.push(row));
    source.pipe(parser);
    try {
      await ended;
    } finally {
      source.destroy();
      parser.destroy();
    }
    assert.deepEqual(rows, [
      { name: 'Example', note: 'Hello, sample 🌍' },
      { name: 'Browser', note: 'two\nlines' },
    ]);
    output.textContent =
      'CSV parser consumed a real file in three-byte chunks, including split Unicode and quoted newlines.\n' +
      JSON.stringify(rows);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
