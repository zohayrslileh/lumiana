import { Worker } from 'node:worker_threads';
import { decodeException, decodeValue, encodeException, encodeValue } from '../values.js';

interface Task {
  worker: Worker;
  settled: boolean;
  streaming: boolean;
  stopTimer?: NodeJS.Timeout;
}

/** Owns isolated task workers for one authenticated connection. */
export class RunKernel {
  private tasks = new Map<number, Task>();

  constructor(
    private root: string,
    private allocateHandle: () => number,
    private event: (packet: any) => void,
    private project: (packet: any) => void,
  ) {}

  execute(descriptor: any, args: any[]): Promise<any> {
    if (!descriptor?.__lumianaRun || typeof descriptor.code !== 'string')
      return Promise.reject(new TypeError('Invalid lumiana.run() task'));
    const handle = this.allocateHandle();
    const worker = new Worker(new URL('./run-worker.js', import.meta.url), {
      workerData: { root: this.root, task: descriptor, args: args.map(encodeValue) },
      stdout: true,
      stderr: true,
      execArgv: ['--experimental-vm-modules'],
    });
    const task: Task = { worker, settled: false, streaming: false };
    this.tasks.set(handle, task);
    worker.stdout?.on('data', (chunk: Buffer) =>
      this.project({ type: 'console', level: 'log', text: chunk.toString() }),
    );
    worker.stderr?.on('data', (chunk: Buffer) =>
      this.project({ type: 'console', level: 'error', text: chunk.toString() }),
    );
    return new Promise((resolve, reject) => {
      const fail = (error: unknown) => {
        if (!task.settled) {
          task.settled = true;
          reject(error);
        } else if (task.streaming)
          this.event({ type: 'run-event', handle, event: 'error', error: encodeException(error) });
        this.remove(handle);
      };
      worker.on('message', (message: any) => {
        if (message.type === 'console') {
          this.project(message);
          return;
        }
        if (message.type === 'stream') {
          task.streaming = true;
          task.settled = true;
          resolve({ __lumianaRunStream: handle });
        } else if (message.type === 'result') {
          task.settled = true;
          resolve(decodeValue(message.value));
          this.remove(handle, false);
        } else if (message.type === 'yield')
          this.event({ type: 'run-event', handle, event: 'yield', value: message.value });
        else if (message.type === 'return') {
          this.event({ type: 'run-event', handle, event: 'return', value: message.value });
          this.remove(handle, false);
        } else if (message.type === 'error') {
          if (!task.settled) fail(decodeException(message.error));
          else {
            this.event({ type: 'run-event', handle, event: 'error', error: message.error });
            this.remove(handle, false);
          }
        }
      });
      worker.once('error', fail);
      worker.once('exit', (code) => {
        if (!task.settled) fail(new Error(`Lumiana task worker stopped with code ${code}`));
        else if (task.streaming && this.tasks.has(handle))
          fail(new Error(`Lumiana task worker stopped before completing (code ${code})`));
      });
    });
  }

  credit(handle: number, count: number): void {
    this.tasks.get(handle)?.worker.postMessage({ type: 'credit', count });
  }

  cancel(handle: number): void {
    const task = this.tasks.get(handle);
    if (!task) return;
    task.worker.postMessage({ type: 'cancel' });
    task.stopTimer = setTimeout(() => this.remove(handle), 1_000);
    task.stopTimer.unref();
  }

  close(): void {
    for (const handle of [...this.tasks.keys()]) this.remove(handle);
  }

  private remove(handle: number, terminate = true): void {
    const task = this.tasks.get(handle);
    if (!task) return;
    this.tasks.delete(handle);
    if (task.stopTimer) clearTimeout(task.stopTimer);
    if (terminate) void task.worker.terminate();
  }
}
