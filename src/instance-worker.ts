import { parentPort, workerData } from 'node:worker_threads';
import { decodeValue, encodeException, encodeValue } from './values.js';
import { createWorkerContext } from './worker-context.js';

if (!parentPort) throw new Error('A Lumiana worker instance requires a worker thread');
const port = parentPort;

const descriptor = workerData.descriptor as {
  code: string;
  filename: string;
  __lumianaSharedWorker?: boolean;
};
const apiName = descriptor.__lumianaSharedWorker ? 'sharedWorker' : 'worker';
const context = createWorkerContext(descriptor, workerData.root, 'worker', (packet) =>
  port.postMessage(packet),
);

interface Subscription {
  client: string;
  id: number;
  iterator: AsyncIterator<any> | Iterator<any>;
  asynchronous: boolean;
  credit: number;
  cancelled: boolean;
  wake?: () => void;
}

let api: Record<string, Function>;
const subscriptions = new Map<string, Subscription>();
const key = (client: string, id: number) => `${client}:${id}`;

function sendSubscription(subscription: Subscription, packet: any): void {
  port.postMessage({
    type: 'subscription-event',
    client: subscription.client,
    subscription: subscription.id,
    ...packet,
  });
}

async function cancel(subscription: Subscription): Promise<void> {
  if (subscription.cancelled) return;
  subscription.cancelled = true;
  subscriptions.delete(key(subscription.client, subscription.id));
  subscription.wake?.();
  subscription.wake = undefined;
  try {
    await subscription.iterator.return?.();
  } catch {}
}

async function pump(subscription: Subscription): Promise<void> {
  try {
    for (;;) {
      if (!subscription.credit && !subscription.cancelled)
        await new Promise<void>((resolve) => {
          subscription.wake = resolve;
        });
      if (subscription.cancelled) return;
      subscription.credit--;
      const next = await subscription.iterator.next();
      const value = subscription.asynchronous ? next.value : await next.value;
      if (subscription.cancelled) return;
      if (next.done) {
        subscriptions.delete(key(subscription.client, subscription.id));
        sendSubscription(subscription, { event: 'return', value: encodeValue(value) });
        return;
      }
      sendSubscription(subscription, { event: 'yield', value: encodeValue(value) });
    }
  } catch (error) {
    subscriptions.delete(key(subscription.client, subscription.id));
    if (!subscription.cancelled)
      sendSubscription(subscription, { event: 'error', error: encodeException(error) });
  }
}

async function subscribe(message: any): Promise<void> {
  try {
    const method = api[message.method];
    if (typeof method !== 'function')
      throw new TypeError(`Unknown worker method ${message.method}`);
    const value = Reflect.apply(method, api, message.args.map(decodeValue));
    const asynchronous = typeof value?.[Symbol.asyncIterator] === 'function';
    const iterator = asynchronous
      ? value[Symbol.asyncIterator]()
      : typeof value?.[Symbol.iterator] === 'function'
        ? value[Symbol.iterator]()
        : undefined;
    if (!iterator || typeof iterator.next !== 'function')
      throw new TypeError(`Worker subscription ${message.method} did not return an iterator`);
    const subscription: Subscription = {
      client: message.client,
      id: message.subscription,
      iterator,
      asynchronous,
      credit: 0,
      cancelled: false,
    };
    subscriptions.set(key(subscription.client, subscription.id), subscription);
    void pump(subscription);
  } catch (error) {
    port.postMessage({
      type: 'subscription-event',
      client: message.client,
      subscription: message.subscription,
      event: 'error',
      error: encodeException(error),
    });
  }
}

port.on('message', (message: any) => {
  if (message.type === 'call') {
    void (async () => {
      try {
        const method = api[message.method];
        if (typeof method !== 'function')
          throw new TypeError(`Unknown worker method ${message.method}`);
        const value = await Reflect.apply(method, api, message.args.map(decodeValue));
        port.postMessage({
          type: 'call-result',
          client: message.client,
          id: message.id,
          ok: true,
          value: encodeValue(value),
        });
      } catch (error) {
        port.postMessage({
          type: 'call-result',
          client: message.client,
          id: message.id,
          ok: false,
          error: encodeException(error),
        });
      }
    })();
  } else if (message.type === 'subscribe') void subscribe(message);
  else if (message.type === 'credit') {
    const subscription = subscriptions.get(key(message.client, message.subscription));
    if (!subscription || subscription.cancelled) return;
    subscription.credit += Math.max(0, Number(message.count) || 0);
    subscription.wake?.();
    subscription.wake = undefined;
  } else if (message.type === 'cancel') {
    const subscription = subscriptions.get(key(message.client, message.subscription));
    if (subscription) void cancel(subscription);
  } else if (message.type === 'detach') {
    for (const subscription of [...subscriptions.values()])
      if (subscription.client === message.client) void cancel(subscription);
  } else if (message.type === 'close') {
    Promise.all([...subscriptions.values()].map(cancel)).finally(() => port.close());
  }
});

async function initialize(): Promise<void> {
  try {
    const initialize = context.load();
    if (typeof initialize !== 'function')
      throw new TypeError(`lumiana.${apiName}() requires an initializer function`);
    const value = await Reflect.apply(
      initialize,
      undefined,
      (workerData.args as any[]).map(decodeValue),
    );
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
      throw new TypeError(`lumiana.${apiName}() initializer must return an object of functions`);
    api = value as Record<string, Function>;
    const methods = Object.keys(api).map((name) => {
      const method = api[name];
      if (typeof method !== 'function')
        throw new TypeError(`Worker export ${name} must be a function`);
      if (name === 'terminate')
        throw new TypeError('Worker export terminate conflicts with its lifecycle method');
      const constructor = method.constructor?.name;
      return {
        name,
        kind:
          constructor === 'GeneratorFunction' || constructor === 'AsyncGeneratorFunction'
            ? 'subscription'
            : 'method',
      };
    });
    port.postMessage({ type: 'ready', methods });
  } catch (error) {
    port.postMessage({ type: 'fatal', error: encodeException(error) });
    port.close();
  }
}

void initialize();
