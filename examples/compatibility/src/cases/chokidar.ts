import chokidar from 'chokidar';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const folder = await mkdtemp(join(tmpdir(), 'lumiana-watch-'));
  const watcher = chokidar.watch(folder, { ignoreInitial: true, usePolling: false });
  const seen: string[] = [];
  watcher.on('all', (event) => seen.push(event));
  try {
    assert.equal(watcher.options.usePolling, false);
    await once(watcher, 'ready');
    let next = once(watcher, 'add');
    await writeFile(join(folder, 'note.txt'), 'first');
    await next;
    next = once(watcher, 'change');
    await writeFile(join(folder, 'note.txt'), 'changed — sample');
    await next;
    next = once(watcher, 'unlink');
    await rm(join(folder, 'note.txt'));
    await next;
    await watcher.close();
    const count = seen.length;
    await writeFile(join(folder, 'closed.txt'), 'no event');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(seen.length, count);
    assert.deepEqual(seen, ['add', 'change', 'unlink']);
    output.textContent =
      'Native watcher: ' + seen.join(' → ') + '.\nClosed watcher delivered no later events.';
  } finally {
    await watcher.close();
    await rm(folder, { recursive: true, force: true });
  }
}
