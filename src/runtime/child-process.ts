import EventEmitter from 'events';
import stream from 'stream-browserify';
import { Buffer } from 'buffer';
import { kernelCall, kernelCallSync, kernelSubscribe } from './bridge.js';
import { promisify } from './util.js';

class ChildReadable extends stream.Readable {
  _read() {}
  receive(data: Uint8Array) {
    this.push(Buffer.from(data));
  }
  finish() {
    this.push(null);
  }
}

class ChildWritable extends stream.Writable {
  constructor(private owner: ChildProcess) {
    super();
  }
  _write(chunk: any, encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.owner
      .operation('child.stdin.write', Buffer.from(chunk), encoding)
      .then(() => done(), done);
  }
  _final(done: (error?: Error | null) => void) {
    this.owner.operation('child.stdin.end').then(() => done(), done);
  }
}

export class ChildProcess extends EventEmitter {
  pid: number | undefined;
  connected = false;
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  readonly stdin = new ChildWritable(this);
  readonly stdout = new ChildReadable();
  readonly stderr = new ChildReadable();
  readonly stdio = [this.stdin, this.stdout, this.stderr] as const;
  private handle?: number;
  private unsubscribe?: () => void;
  private ready: Promise<number>;

  constructor(command: string, args: readonly string[] = [], options?: any) {
    super();
    this.ready = kernelCall('child.spawn', command, [...args], options).then((result) => {
      this.handle = result.handle;
      this.pid = result.pid;
      this.connected = result.connected;
      this.unsubscribe = kernelSubscribe(result.handle, (event, values) =>
        this.receive(event, values),
      );
      void kernelCall('child.attach', result.handle);
      return result.handle;
    });
    void this.ready.catch((error) => this.emit('error', error));
  }

  private receive(event: string, args: any[]) {
    if (event === 'stdout.data') return this.stdout.receive(args[0]);
    if (event === 'stdout.end') return this.stdout.finish();
    if (event === 'stderr.data') return this.stderr.receive(args[0]);
    if (event === 'stderr.end') return this.stderr.finish();
    if (event === 'exit') {
      this.exitCode = args[0];
      this.signalCode = args[1];
    }
    if (event === 'disconnect') this.connected = false;
    this.emit(event, ...args);
    if (event === 'close') this.unsubscribe?.();
  }

  operation(name: string, ...args: any[]): Promise<any> {
    return this.ready.then((handle) => kernelCall(name, handle, ...args));
  }
  kill(signal?: string | number) {
    this.killed = true;
    void this.operation('child.kill', signal);
    return true;
  }
  send(message: any, callback?: (error: Error | null) => void) {
    void this.operation('child.send', message).then(
      () => callback?.(null),
      (error) => callback?.(error),
    );
    return true;
  }
  disconnect() {
    void this.operation('child.disconnect');
  }
  ref() {
    void this.operation('child.ref');
    return this;
  }
  unref() {
    void this.operation('child.unref');
    return this;
  }
}

const normalize = (args?: readonly string[] | any, options?: any) =>
  Array.isArray(args) ? { args, options } : { args: [], options: args };

export function spawn(
  command: string,
  args?: readonly string[] | any,
  options?: any,
): ChildProcess {
  const normalized = normalize(args, options);
  return new ChildProcess(command, normalized.args, normalized.options);
}

export function execFile(
  file: string,
  args?: readonly string[] | any,
  options?: any,
  callback?: (error: Error | null, stdout: any, stderr: any) => void,
): ChildProcess {
  if (typeof args === 'function') [callback, args] = [args, []];
  else if (typeof options === 'function') [callback, options] = [options, undefined];
  const child = spawn(file, args, options);
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  let complete = false;
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const finish = (error: Error | null, code?: number | null) => {
    if (complete) return;
    complete = true;
    const out = Buffer.concat(stdout),
      err = Buffer.concat(stderr),
      encoding = options?.encoding ?? 'utf8';
    const values =
      encoding === 'buffer' ? [out, err] : [out.toString(encoding), err.toString(encoding)];
    const failure =
      error ??
      (code ? Object.assign(new Error(`Command failed with exit code ${code}`), { code }) : null);
    if (failure) Object.assign(failure, { stdout: values[0], stderr: values[1] });
    callback?.(failure, values[0], values[1]);
  };
  child.once('error', (error) => finish(error));
  child.once('close', (code) => finish(null, code));
  return child;
}

export function exec(
  command: string,
  options?: any,
  callback?: (error: Error | null, stdout: any, stderr: any) => void,
): ChildProcess {
  if (typeof options === 'function') [callback, options] = [options, undefined];
  return execFile(command, [], { ...options, shell: options?.shell ?? true }, callback);
}

export function fork(
  modulePath: string,
  args?: readonly string[] | any,
  options?: any,
): ChildProcess {
  const normalized = normalize(args, options);
  return spawn(globalThis.process?.execPath ?? 'node', [modulePath, ...normalized.args], {
    ...normalized.options,
    stdio: normalized.options?.stdio ?? ['pipe', 'pipe', 'pipe', 'ipc'],
  });
}

type ExecResult = { stdout: any; stderr: any };
type PromisifiedChild = Promise<ExecResult> & { child: ChildProcess };
const promise = (
  start: (done: (error: Error | null, stdout: any, stderr: any) => void) => ChildProcess,
) => {
  let child!: ChildProcess;
  const result = new Promise<ExecResult>((resolve, reject) => {
    child = start((error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr })));
  }) as PromisifiedChild;
  result.child = child;
  return result;
};

(exec as any)[promisify.custom] = (command: string, options?: any) =>
  promise((done) => exec(command, options, done));
(execFile as any)[promisify.custom] = (
  file: string,
  args?: readonly string[] | any,
  options?: any,
) => promise((done) => execFile(file, args, options, done));

const sync =
  (name: string) =>
  (...args: any[]) =>
    kernelCallSync(`child.${name}`, ...args);
export const execFileSync = sync('execFileSync');
export const execSync = sync('execSync');
export const spawnSync = sync('spawnSync');

export default { ChildProcess, exec, execFile, execFileSync, execSync, fork, spawn, spawnSync };
