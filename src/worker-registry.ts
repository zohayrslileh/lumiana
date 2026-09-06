import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { failure } from './protocol.js';
import { encodeValue } from './values.js';

interface WorkerEntry {
  identity: string;
  digest: string;
  worker: Worker;
  clients: Set<string>;
  calls: Map<string, { client: string; id: number }>;
  ready: Promise<WorkerMethod[]>;
  resolveReady: (methods: WorkerMethod[]) => void;
  rejectReady: (error: unknown) => void;
  settled: boolean;
  stopping: boolean;
}

interface WorkerMethod {
  name: string;
  kind: 'method' | 'subscription';
}

export type WorkerLifetime = 'shared' | 'session';

/** Owns stateful workers; the lifetime policy alone determines reuse and teardown. */
export class WorkerRegistry {
  private workers = new Map<string, WorkerEntry>();

  constructor(
    private root: string,
    private lifetime: WorkerLifetime,
    private connected: (client: string) => boolean,
    private deliver: (client: string, packet: any) => void,
  ) {}

  handle(client: string, packet: any): boolean {
    const prefix = this.lifetime === 'shared' ? 'shared' : 'worker';
    if (packet.type === `${prefix}-open`) {
      void this.open(client, packet.descriptor, packet.args).then(
        (value) =>
          this.deliver(client, {
            type: 'result',
            id: packet.id,
            ok: true,
            value: encodeValue(value),
          }),
        (error) =>
          this.deliver(client, {
            type: 'result',
            id: packet.id,
            ok: false,
            error: failure(error),
          }),
      );
      return true;
    }
    if (!String(packet.type).startsWith(`${prefix}-`)) return false;
    const entry = this.workers.get(packet.identity);
    if (!entry || !entry.clients.has(client)) {
      const error = failure(new ReferenceError('Unknown or detached Lumiana worker'));
      if (packet.id !== undefined)
        this.deliver(client, { type: 'result', id: packet.id, ok: false, error });
      else if (packet.subscription !== undefined)
        this.deliver(client, {
          type: 'subscription-event',
          subscription: packet.subscription,
          event: 'error',
          error,
        });
      return true;
    }
    if (packet.type === `${prefix}-call`) {
      entry.calls.set(`${client}:${packet.id}`, { client, id: packet.id });
      entry.worker.postMessage({ ...packet, type: 'call', client });
    } else if (packet.type === `${prefix}-subscribe`)
      entry.worker.postMessage({ ...packet, type: 'subscribe', client });
    else if (packet.type === `${prefix}-credit`)
      entry.worker.postMessage({ ...packet, type: 'credit', client });
    else if (packet.type === `${prefix}-cancel`)
      entry.worker.postMessage({ ...packet, type: 'cancel', client });
    else if (packet.type === `${prefix}-terminate`) {
      this.deliver(client, {
        type: 'result',
        id: packet.id,
        ok: true,
        value: encodeValue(undefined),
      });
      void this.stop(entry);
    } else if (packet.id !== undefined)
      this.deliver(client, {
        type: 'result',
        id: packet.id,
        ok: false,
        error: failure(new TypeError(`Unknown shared worker operation ${packet.type}`)),
      });
    return true;
  }

  detach(client: string): void {
    for (const entry of this.workers.values())
      if (entry.clients.delete(client)) {
        for (const [key, call] of entry.calls) if (call.client === client) entry.calls.delete(key);
        entry.worker.postMessage({ type: 'detach', client });
        if (this.lifetime === 'session') void this.stop(entry);
      }
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers.values()].map((entry) => this.stop(entry)));
  }

  private async open(client: string, descriptor: any, args: any[]) {
    const brand = this.lifetime === 'shared' ? '__lumianaSharedWorker' : '__lumianaWorker';
    if (
      !descriptor?.[brand] ||
      typeof descriptor.code !== 'string' ||
      typeof descriptor.filename !== 'string' ||
      (this.lifetime === 'shared' &&
        (typeof descriptor.identity !== 'string' || typeof descriptor.digest !== 'string')) ||
      !Array.isArray(args)
    )
      throw new TypeError(
        `Invalid lumiana.${this.lifetime === 'shared' ? 'sharedWorker' : 'worker'}() initializer`,
      );
    const identity = this.lifetime === 'shared' ? descriptor.identity : `worker:${randomUUID()}`;
    let entry = this.lifetime === 'shared' ? this.workers.get(identity) : undefined;
    if (entry && entry.digest !== descriptor.digest)
      throw new Error(
        'The shared worker definition changed while its previous instance is still alive. Terminate the existing instance before starting the new definition.',
      );
    entry ??= this.create({ ...descriptor, identity, digest: descriptor.digest ?? '' }, args);
    entry.clients.add(client);
    const methods = await entry.ready;
    if (!this.connected(client)) throw new Error('Lumiana is disconnected');
    return { identity: entry.identity, methods };
  }

  private create(descriptor: any, args: any[]): WorkerEntry {
    let resolveReady!: WorkerEntry['resolveReady'];
    let rejectReady!: WorkerEntry['rejectReady'];
    const ready = new Promise<WorkerMethod[]>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const worker = new Worker(new URL('./instance-worker.js', import.meta.url), {
      workerData: { root: this.root, descriptor, args },
      stdout: true,
      stderr: true,
      execArgv: ['--experimental-vm-modules'],
    });
    const entry: WorkerEntry = {
      identity: descriptor.identity,
      digest: descriptor.digest,
      worker,
      clients: new Set(),
      calls: new Map(),
      ready,
      resolveReady,
      rejectReady,
      settled: false,
      stopping: false,
    };
    this.workers.set(entry.identity, entry);
    for (const [stream, level] of [
      [worker.stdout, 'log'],
      [worker.stderr, 'error'],
    ] as const)
      stream?.on('data', (chunk: Buffer) => {
        for (const client of entry.clients)
          this.deliver(client, { type: 'console', level, text: chunk.toString() });
      });
    worker.on('message', (message: any) => {
      if (message.type === 'ready') {
        if (!entry.settled) {
          entry.settled = true;
          entry.resolveReady(message.methods);
        }
      } else if (message.type === 'console') {
        for (const client of entry.clients) this.deliver(client, message);
      } else if (message.type === 'call-result') {
        entry.calls.delete(`${message.client}:${message.id}`);
        this.deliver(message.client, { ...message, type: 'result' });
      } else if (message.type === 'subscription-event') this.deliver(message.client, message);
      else if (message.type === 'fatal') {
        const error = Object.assign(new Error(message.error?.message ?? 'Shared worker failed'), {
          name: message.error?.name ?? 'Error',
          stack: message.error?.stack,
        });
        void this.stop(entry, error, true, true);
      }
    });
    worker.once('error', (error) => void this.stop(entry, error, true, true));
    worker.once('exit', (code) => {
      if (!entry.stopping)
        void this.stop(entry, new Error(`Lumiana worker stopped with code ${code}`), false, true);
    });
    return entry;
  }

  private async stop(
    entry: WorkerEntry,
    error: unknown = new Error('Lumiana worker terminated'),
    terminate = true,
    fatal = false,
  ): Promise<void> {
    if (entry.stopping) return;
    entry.stopping = true;
    if (this.workers.get(entry.identity) === entry) this.workers.delete(entry.identity);
    if (!entry.settled) {
      entry.settled = true;
      entry.rejectReady(error);
    }
    for (const call of entry.calls.values())
      this.deliver(call.client, {
        type: 'result',
        id: call.id,
        ok: false,
        error: failure(error),
      });
    entry.calls.clear();
    for (const client of entry.clients)
      this.deliver(client, {
        type: `${this.lifetime === 'shared' ? 'shared' : 'worker'}-stopped`,
        identity: entry.identity,
        error: failure(error),
        fatal,
      });
    entry.clients.clear();
    if (terminate) {
      try {
        entry.worker.postMessage({ type: 'close' });
      } catch {}
      await entry.worker.terminate().catch(() => undefined);
    }
  }
}
