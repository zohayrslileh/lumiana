let total = 0;
let subscriptions = 0;

export function add(amount: number) {
  total += amount;
  return { total, binary: Buffer.from([total, 255 - total]) };
}

export function current() {
  return total;
}

export async function* changes(count: number) {
  for (let index = 0; index < count; index++) yield ++total;
  return total;
}

export async function* watch() {
  subscriptions++;
  try {
    for (let index = 0; ; index++) yield index;
  } finally {
    subscriptions--;
  }
}

export function activeSubscriptions() {
  return subscriptions;
}
