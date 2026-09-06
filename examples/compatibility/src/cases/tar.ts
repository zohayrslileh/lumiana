import { create, extract } from 'tar';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert } from '../check';

export async function run(output: HTMLElement) {
  const folder = await mkdtemp(join(tmpdir(), 'lumiana-tar-'));
  try {
    const text = 'A TAR round trip — sample 🌍';
    await writeFile(join(folder, 'note.txt'), text);
    await mkdir(join(folder, 'restored'));
    const file = join(folder, 'archive.tgz');
    await create({ cwd: folder, file, gzip: true }, ['note.txt']);
    await extract({ cwd: join(folder, 'restored'), file });
    assert.equal(await readFile(join(folder, 'restored/note.txt'), 'utf8'), text);
    output.textContent =
      'Original tar created a gzip archive and restored the exact file content.\n' + text;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
