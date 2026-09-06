let count = 0;

const listeners = new Set<(value: number) => void>();

function publish() {
  for (const listener of listeners) listener(count);
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
  const queue: number[] = [];
  let resume: ((value: number) => void) | undefined;
  const receive = (value: number) => {
    if (resume) {
      const resolve = resume;
      resume = undefined;
      resolve(value);
    } else queue.push(value);
  };

  listeners.add(receive);
  try {
    yield count;
    for (;;) {
      yield queue.length
        ? queue.shift()!
        : await new Promise<number>((resolve) => {
            resume = resolve;
          });
    }
  } finally {
    listeners.delete(receive);
  }
}
