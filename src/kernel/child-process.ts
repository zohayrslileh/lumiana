import childProcess, { type ChildProcess } from 'node:child_process';

type Emit = (handle: number, event: string, ...args: any[]) => void;
interface ProcessRecord {
  child: ChildProcess;
  attached: boolean;
  closed: boolean;
  events: [string, any[]][];
}

/** Per-connection host processes; JavaScript process and stream objects stay in the browser. */
export class ChildProcessKernel {
  private processes = new Map<number, ProcessRecord>();
  constructor(
    private emit: Emit,
    private allocate: () => number,
  ) {}

  async close(): Promise<void> {
    const processes = [...this.processes.values()];
    this.processes.clear();
    for (const { child } of processes) child.kill();
  }

  private record(handle: number): ProcessRecord {
    const record = this.processes.get(handle);
    if (!record) throw new ReferenceError(`Unknown child process ${handle}`);
    return record;
  }

  private process(handle: number): ChildProcess {
    return this.record(handle).child;
  }

  private publish(handle: number, event: string, ...args: any[]): void {
    const record = this.processes.get(handle);
    if (!record) return;
    if (record.attached) this.emit(handle, event, ...args);
    else record.events.push([event, args]);
  }

  async execute(operation: string, args: any[]): Promise<any> {
    switch (operation) {
      case 'child.spawn': {
        const handle = this.allocate();
        const child = childProcess.spawn(args[0], args[1], args[2]);
        this.processes.set(handle, { child, attached: false, closed: false, events: [] });
        child.stdout?.on('data', (data) => this.publish(handle, 'stdout.data', data));
        child.stdout?.on('end', () => this.publish(handle, 'stdout.end'));
        child.stderr?.on('data', (data) => this.publish(handle, 'stderr.data', data));
        child.stderr?.on('end', () => this.publish(handle, 'stderr.end'));
        child.on('spawn', () => this.publish(handle, 'spawn'));
        child.on('message', (message, sendHandle) =>
          this.publish(handle, 'message', message, sendHandle),
        );
        child.on('disconnect', () => this.publish(handle, 'disconnect'));
        child.on('error', (error) => this.publish(handle, 'error', error));
        child.on('exit', (code, signal) => this.publish(handle, 'exit', code, signal));
        child.on('close', (code, signal) => {
          this.publish(handle, 'close', code, signal);
          const record = this.processes.get(handle);
          if (record) {
            record.closed = true;
            if (record.attached) this.processes.delete(handle);
          }
        });
        return {
          handle,
          pid: child.pid,
          connected: child.connected,
          stdin: Boolean(child.stdin),
          stdout: Boolean(child.stdout),
          stderr: Boolean(child.stderr),
        };
      }
      case 'child.attach': {
        const handle = Number(args[0]);
        const record = this.record(handle);
        record.attached = true;
        for (const [event, values] of record.events) this.emit(handle, event, ...values);
        record.events.length = 0;
        if (record.closed) this.processes.delete(handle);
        return undefined;
      }
      case 'child.stdin.write':
        return this.process(Number(args[0])).stdin?.write(args[1], args[2]) ?? false;
      case 'child.stdin.end':
        this.process(Number(args[0])).stdin?.end(args[1]);
        return undefined;
      case 'child.kill':
        return this.process(Number(args[0])).kill(args[1]);
      case 'child.send':
        return new Promise((resolve, reject) =>
          this.process(Number(args[0])).send(args[1], (error) =>
            error ? reject(error) : resolve(true),
          ),
        );
      case 'child.disconnect':
        this.process(Number(args[0])).disconnect();
        return undefined;
      case 'child.ref':
        this.process(Number(args[0])).ref();
        return undefined;
      case 'child.unref':
        this.process(Number(args[0])).unref();
        return undefined;
      default:
        throw new TypeError(`Unknown child-process operation ${operation}`);
    }
  }
}
