import { Buffer } from 'buffer';
import stream from './stream.js';
import promises from './fs-promises.js';
import { constants } from './fs-constants.js';
import {
  Dirent,
  Stats,
  directoryResult,
  fileResult,
  inputValue,
  statResult,
} from './filesystem.js';
import { kernelCall, kernelCallSync, kernelSubscribe } from './bridge.js';
import EventEmitter from 'events';

export { Dirent, Stats, constants, promises };

type Callback = (...args: any[]) => void;

const sync = (name: string, convert?: (value: any, args: any[]) => any) => {
  const operation = (...args: any[]) => {
    const value = kernelCallSync(`fs.${name}`, ...args.map(inputValue));
    return convert ? convert(value, args) : value;
  };
  Object.defineProperty(operation, 'name', { value: name });
  return operation;
};

const callback = (name: string, convert?: (values: any[], args: any[]) => any[]) => {
  const operation = (...args: any[]) => {
    const done = args.pop();
    if (typeof done !== 'function') throw new TypeError('The callback argument must be a function');
    void kernelCall('fs.call', name, args.map(inputValue)).then(
      (value) => {
        if (name === 'exists') done(Boolean(value));
        else {
          const converted = convert ? convert(value, args) : value;
          done(null, ...converted);
        }
      },
      (error) => done(error),
    );
  };
  Object.defineProperty(operation, 'name', { value: name });
  return operation;
};

const statValues = (values: any[]) => values.map((value) => statResult(value));
const directoryValues = (values: any[], args: any[]) =>
  args.at(-1)?.withFileTypes ? [values[0].map(directoryResult)] : values;
const binaryValues = (values: any[], args: any[]) => [fileResult(values[0], args[1])];
const bytes = (view: ArrayBufferView) =>
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
const readValues = ([count, returned]: any[], args: any[]) => {
  const target = ArrayBuffer.isView(args[1]) ? args[1] : args[1]?.buffer;
  if (!target) return [count, Buffer.from(returned)];
  const offset =
    (ArrayBuffer.isView(args[1])
      ? typeof args[2] === 'object'
        ? args[2]?.offset
        : args[2]
      : args[1]?.offset) ?? 0;
  bytes(target).set(bytes(returned).subarray(offset, offset + count), offset);
  return [count, target];
};
const readvValues = ([count, returned]: any[], args: any[]) => {
  let remaining = count;
  for (let i = 0; i < args[1].length && remaining > 0; i++) {
    const target = bytes(args[1][i]);
    const length = Math.min(remaining, target.byteLength);
    target.set(bytes(returned[i]).subarray(0, length));
    remaining -= length;
  }
  return [count, args[1]];
};
const writeValues = (values: any[], args: any[]) => [values[0], args[1]];

export const access = callback('access');
export const appendFile = callback('appendFile');
export const chmod = callback('chmod');
export const chown = callback('chown');
export const close = callback('close');
export const copyFile = callback('copyFile');
export const cp = callback('cp');
export const exists = callback('exists');
export const fchmod = callback('fchmod');
export const fchown = callback('fchown');
export const fdatasync = callback('fdatasync');
export const fstat = callback('fstat', statValues);
export const fsync = callback('fsync');
export const ftruncate = callback('ftruncate');
export const futimes = callback('futimes');
export const glob = callback('glob');
export const lchmod = callback('lchmod');
export const lchown = callback('lchown');
export const link = callback('link');
export const lstat = callback('lstat', statValues);
export const lutimes = callback('lutimes');
export const mkdir = callback('mkdir');
export const mkdtemp = callback('mkdtemp');
export const open = callback('open');
export const opendir = callback('opendir');
export const read = callback('read', readValues);
export const readFile = callback('readFile', binaryValues);
export const readdir = callback('readdir', directoryValues);
export const readlink = callback('readlink');
export const readv = callback('readv', readvValues);
export const realpath = callback('realpath');
export const rename = callback('rename');
export const rm = callback('rm');
export const rmdir = callback('rmdir');
export const stat = callback('stat', statValues);
export const statfs = callback('statfs');
export const symlink = callback('symlink');
export const truncate = callback('truncate');
export const unlink = callback('unlink');
export const utimes = callback('utimes');
export const write = callback('write', writeValues);
export const writeFile = callback('writeFile');
export const writev = callback('writev', writeValues);

export const accessSync = sync('accessSync');
export const appendFileSync = sync('appendFileSync');
export const chmodSync = sync('chmodSync');
export const chownSync = sync('chownSync');
export const closeSync = sync('closeSync');
export const copyFileSync = sync('copyFileSync');
export const cpSync = sync('cpSync');
export const existsSync = sync('existsSync');
export const fchmodSync = sync('fchmodSync');
export const fchownSync = sync('fchownSync');
export const fdatasyncSync = sync('fdatasyncSync');
export const fstatSync = sync('fstatSync', statResult);
export const fsyncSync = sync('fsyncSync');
export const ftruncateSync = sync('ftruncateSync');
export const futimesSync = sync('futimesSync');
export const globSync = sync('globSync');
export const lchmodSync = sync('lchmodSync');
export const lchownSync = sync('lchownSync');
export const linkSync = sync('linkSync');
export const lstatSync = sync('lstatSync', statResult);
export const lutimesSync = sync('lutimesSync');
export const mkdirSync = sync('mkdirSync');
export const mkdtempSync = sync('mkdtempSync');
export const openSync = sync('openSync');
export const opendirSync = sync('opendirSync');
export const readFileSync = sync('readFileSync', (value, args) => fileResult(value, args[1]));
export const readdirSync = sync('readdirSync', (value, args) =>
  args[1]?.withFileTypes ? value.map(directoryResult) : value,
);
export const readlinkSync = sync('readlinkSync');
export const readSync = sync('readSync', (value, args) => readValues(value, args)[0]);
export const readvSync = sync('readvSync', (value, args) => readvValues(value, args)[0]);
export const realpathSync = sync('realpathSync');
export const renameSync = sync('renameSync');
export const rmSync = sync('rmSync');
export const rmdirSync = sync('rmdirSync');
export const statSync = sync('statSync', statResult);
export const statfsSync = sync('statfsSync');
export const symlinkSync = sync('symlinkSync');
export const truncateSync = sync('truncateSync');
export const unlinkSync = sync('unlinkSync');
export const utimesSync = sync('utimesSync');
export const writeFileSync = sync('writeFileSync');
export const writeSync = sync('writeSync');
export const writevSync = sync('writevSync');

Object.assign(realpath, { native: realpath });
Object.assign(realpathSync, { native: realpathSync });

export class ReadStream extends stream.Readable {
  path: any;
  pending = true;
  private started = false;
  constructor(
    path: any,
    private options: any = {},
  ) {
    super(options);
    this.path = path;
  }
  _read() {
    if (this.started) return;
    this.started = true;
    void promises.readFile(this.path).then(
      (value: any) => {
        this.pending = false;
        const bytes = Buffer.from(value);
        const start = this.options.start ?? 0;
        const end = this.options.end === undefined ? bytes.length : this.options.end + 1;
        this.push(bytes.subarray(start, end));
        this.push(null);
      },
      (error: Error) => this.destroy(error),
    );
  }
}

export class WriteStream extends stream.Writable {
  path: any;
  pending = true;
  private chunks: Buffer[] = [];
  constructor(
    path: any,
    private options: any = {},
  ) {
    super(options);
    this.path = path;
  }
  _write(chunk: any, encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    done();
  }
  _final(done: (error?: Error | null) => void) {
    const data = Buffer.concat(this.chunks);
    const method = this.options.flags?.startsWith('a') ? promises.appendFile : promises.writeFile;
    void method(this.path, data, this.options).then(() => {
      this.pending = false;
      done();
    }, done);
  }
}

export { ReadStream as FileReadStream, WriteStream as FileWriteStream };

export const _toUnixTimestamp = (time: string | number | Date): number => {
  if (typeof time === 'string' && Number.isNaN(Number(time))) return Date.parse(time) / 1000;
  if (time instanceof Date) return time.getTime() / 1000;
  return Number(time);
};

export const createReadStream = (path: any, options?: any) => new ReadStream(path, options);
export const createWriteStream = (path: any, options?: any) => new WriteStream(path, options);

export class FSWatcher extends EventEmitter {
  private handle?: number;
  private closed = false;
  private unsubscribe?: () => void;
  constructor(operation: 'fs.watch' | 'fs.watchFile', path: any, options?: any) {
    super();
    void kernelCall(operation, path, options).then(
      (handle) => {
        this.handle = handle;
        this.unsubscribe = kernelSubscribe(handle, (event, args) => {
          if (operation === 'fs.watchFile' && event === 'change')
            this.emit(event, statResult(args[0]), statResult(args[1]));
          else {
            this.emit(event, ...args);
            if (event === 'close') this.unsubscribe?.();
          }
        });
        void kernelCall('fs.watcher.attach', handle);
        if (this.closed) void kernelCall('fs.watcher.close', handle);
      },
      (error) => this.emit('error', error),
    );
  }
  close() {
    this.closed = true;
    if (this.handle !== undefined) void kernelCall('fs.watcher.close', this.handle);
    return this;
  }
  ref() {
    if (this.handle !== undefined) void kernelCall('fs.watcher.ref', this.handle);
    return this;
  }
  unref() {
    if (this.handle !== undefined) void kernelCall('fs.watcher.unref', this.handle);
    return this;
  }
}

export class StatWatcher extends FSWatcher {}

export function watch(path: any, options?: any, listener?: Callback): FSWatcher {
  if (typeof options === 'function') [listener, options] = [options, undefined];
  const watcher = new FSWatcher('fs.watch', path, options);
  if (listener) watcher.on('change', listener);
  return watcher;
}

const watched = new Map<any, Set<{ listener: Callback; watcher: StatWatcher }>>();
export function watchFile(path: any, options?: any, listener?: Callback): StatWatcher {
  if (typeof options === 'function') [listener, options] = [options, undefined];
  if (!listener) throw new TypeError('The listener argument must be a function');
  const watcher = new StatWatcher('fs.watchFile', path, options);
  watcher.on('change', listener);
  const entries = watched.get(path) ?? new Set();
  entries.add({ listener, watcher });
  watched.set(path, entries);
  return watcher;
}

export function unwatchFile(path: any, listener?: Callback): void {
  const entries = watched.get(path);
  if (!entries) return;
  for (const entry of entries)
    if (!listener || entry.listener === listener) {
      entry.watcher.close();
      entries.delete(entry);
    }
  if (!entries.size) watched.delete(path);
}

const runtime = {
  Dirent,
  FSWatcher,
  ReadStream,
  Stats,
  StatWatcher,
  WriteStream,
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  constants,
  copyFile,
  copyFileSync,
  cp,
  cpSync,
  createReadStream,
  createWriteStream,
  exists,
  existsSync,
  fchmod,
  fchmodSync,
  fchown,
  fchownSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  glob,
  globSync,
  lchmod,
  lchmodSync,
  lchown,
  lchownSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  lutimes,
  lutimesSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openSync,
  opendir,
  opendirSync,
  promises,
  readFile,
  readFileSync,
  read,
  readSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  readv,
  readvSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  rmdir,
  rmdirSync,
  stat,
  statSync,
  statfs,
  statfsSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  utimes,
  utimesSync,
  watch,
  watchFile,
  unwatchFile,
  writeFile,
  writeFileSync,
  write,
  writeSync,
  writev,
  writevSync,
};

export default runtime;
