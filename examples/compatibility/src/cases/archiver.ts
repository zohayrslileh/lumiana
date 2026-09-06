import { ZipArchive } from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const folder = await mkdtemp(join(tmpdir(), 'lumiana-zip-'));
  const source = join(folder, 'note.txt'),
    dest = join(folder, 'result.zip');
  try {
    const text = 'A real file — sample 🌍';
    await writeFile(source, text);
    const zip = new ZipArchive({ zlib: { level: 6 } }),
      stream = createWriteStream(dest);
    const written = once(stream, 'finish');
    zip.on('error', (error) => stream.destroy(error));
    zip.pipe(stream);
    zip.file(source, { name: 'note.txt' });
    await Promise.all([zip.finalize(), written]);
    const bytes = Buffer.from(await readFile(dest));
    const end = bytes.length - 22;
    assert.equal(bytes.readUInt32LE(end), 0x06054b50);
    const central = bytes.readUInt32LE(end + 16);
    assert.equal(bytes.readUInt32LE(central), 0x02014b50);
    const size = bytes.readUInt32LE(central + 20),
      local = bytes.readUInt32LE(central + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.equal(bytes.readUInt16LE(central + 10), 8);
    assert.equal(inflateRawSync(bytes.subarray(start, start + size)).toString(), text);
    output.textContent = `Archiver compressed a real file to ${bytes.length} ZIP bytes.\nRead back and decompressed exact Unicode content.`;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
