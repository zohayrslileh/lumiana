// @ts-nocheck
import chokidar from 'chokidar';
import { mkdtemp, writeFile, appendFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = document.createElement('pre');
document.body.replaceChildren(output);

const results = {
  success: false,
  events: [],
};

function render(stage) {
  output.textContent = JSON.stringify({ stage, ...results }, null, 2);
}

function waitForEvent(watcher, expected, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.off('all', listener);
      reject(new Error(`Timed out waiting for "${expected}"`));
    }, timeout);

    function listener(event, path) {
      results.events.push({ event, path });
      render(`received: ${event}`);

      if (event === expected) {
        clearTimeout(timer);
        watcher.off('all', listener);
        resolve(path);
      }
    }

    watcher.on('all', listener);
  });
}

const directory = await mkdtemp(join(tmpdir(), 'lumiana-watch-'));

const file = join(directory, 'message.txt');
let watcher;

try {
  render('creating watcher');

  watcher = chokidar.watch(directory, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 20,
    },
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Watcher did not become ready')), 5000);

    watcher.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  render('creating file');
  const added = waitForEvent(watcher, 'add');
  await writeFile(file, 'Hello');
  await added;

  render('modifying file');
  const changed = waitForEvent(watcher, 'change');
  await appendFile(file, ' from Lumiana');
  await changed;

  render('deleting file');
  const deleted = waitForEvent(watcher, 'unlink');
  await unlink(file);
  await deleted;

  results.success = true;
  results.summary = {
    addReceived: results.events.some((item) => item.event === 'add'),
    changeReceived: results.events.some((item) => item.event === 'change'),
    unlinkReceived: results.events.some((item) => item.event === 'unlink'),
    callbackUpdatedDOM: true,
  };

  render('completed');
} catch (error) {
  results.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  render('failed');
} finally {
  if (watcher) {
    await watcher.close();
  }

  await rm(directory, {
    recursive: true,
    force: true,
  });
}
