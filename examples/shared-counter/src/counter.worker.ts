import { EventEmitter, on } from 'node:events';

let count = 0;
const events = new EventEmitter();

function publish() {
  events.emit('change', count);
  return count;
}

export function current() {
  return count;
}

export function increment(amount = 1) {
  count += amount;
  return publish();
}

export function decrement(amount = 1) {
  count -= amount;
  return publish();
}

export function reset() {
  count = 0;
  return publish();
}

export async function* changes() {
  const updates = on(events, 'change');

  try {
    yield count;
    for await (const [value] of updates) yield value as number;
  } finally {
    await updates.return?.();
  }
}
