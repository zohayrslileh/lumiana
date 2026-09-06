import glob from 'fast-glob';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert } from '../check';

export async function run(output: HTMLElement) {
  const folder = await mkdtemp(join(tmpdir(), 'lumiana-glob-'));
  try {
    await mkdir(join(folder, 'nested'));
    await writeFile(join(folder, 'nested', 'note.txt'), 'hello');
    await writeFile(join(folder, 'skip.log'), 'skip');
    const files = await glob('**/*.txt', { cwd: folder });
    assert.deepEqual(files, ['nested/note.txt']);
    assert.deepEqual(glob.sync('**/*.txt', { cwd: folder }), files);
    output.textContent = 'Asynchronous and synchronous directory scans agree:\n' + files.join('\n');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
