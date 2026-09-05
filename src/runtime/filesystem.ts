import { Buffer } from 'buffer';

export type KernelCall = (operation: string, ...args: any[]) => Promise<any>;

type FileType =
  | 'file'
  | 'directory'
  | 'blockDevice'
  | 'characterDevice'
  | 'symbolicLink'
  | 'fifo'
  | 'socket'
  | 'unknown';

const isType = (actual: FileType, expected: FileType) => actual === expected;

class Stats {
  [key: string]: any;
  constructor(record: Record<string, any>) {
    Object.assign(this, record);
    for (const name of ['atime', 'mtime', 'ctime', 'birthtime'])
      this[name] = new Date(Number(record[`${name}Ms`]));
  }
  isFile() {
    return isType(this.type, 'file');
  }
  isDirectory() {
    return isType(this.type, 'directory');
  }
  isBlockDevice() {
    return isType(this.type, 'blockDevice');
  }
  isCharacterDevice() {
    return isType(this.type, 'characterDevice');
  }
  isSymbolicLink() {
    return isType(this.type, 'symbolicLink');
  }
  isFIFO() {
    return isType(this.type, 'fifo');
  }
  isSocket() {
    return isType(this.type, 'socket');
  }
}

class Dirent {
  name: string | Buffer;
  parentPath: string;
  path: string;
  private type: FileType;
  constructor(record: any) {
    this.name = binary(record.name);
    this.parentPath = record.parentPath;
    this.path = record.parentPath;
    this.type = record.type;
  }
  isFile() {
    return isType(this.type, 'file');
  }
  isDirectory() {
    return isType(this.type, 'directory');
  }
  isBlockDevice() {
    return isType(this.type, 'blockDevice');
  }
  isCharacterDevice() {
    return isType(this.type, 'characterDevice');
  }
  isSymbolicLink() {
    return isType(this.type, 'symbolicLink');
  }
  isFIFO() {
    return isType(this.type, 'fifo');
  }
  isSocket() {
    return isType(this.type, 'socket');
  }
}

Object.defineProperty(Stats, 'name', { value: 'Stats' });
Object.defineProperty(Dirent, 'name', { value: 'Dirent' });

const binary = (value: any) => (value instanceof Uint8Array ? Buffer.from(value) : value);
const input = (value: any) => (Buffer.isBuffer(value) ? new Uint8Array(value) : value);
const result = (value: any, options?: any) =>
  typeof options === 'string' || options?.encoding ? value : binary(value);

export function createFileSystem(call: KernelCall) {
  class FileHandle {
    readonly fd: number;
    private closed = false;
    constructor(
      private handle: number,
      fd: number,
    ) {
      this.fd = fd;
    }
    private assert() {
      if (this.closed) throw new Error('file closed');
    }
    async close() {
      this.assert();
      this.closed = true;
      await call('fs.handle.close', this.handle);
    }
    async readFile(options?: any) {
      this.assert();
      return result(await call('fs.handle.readFile', this.handle, options), options);
    }
    async writeFile(data: any, options?: any) {
      this.assert();
      await call('fs.handle.writeFile', this.handle, input(data), options);
    }
    async appendFile(data: any, options?: any) {
      this.assert();
      await call('fs.handle.appendFile', this.handle, input(data), options);
    }
    async truncate(length = 0) {
      this.assert();
      await call('fs.handle.truncate', this.handle, length);
    }
    async sync() {
      this.assert();
      await call('fs.handle.sync', this.handle);
    }
    async datasync() {
      this.assert();
      await call('fs.handle.datasync', this.handle);
    }
    async stat(options?: any) {
      this.assert();
      return new Stats(await call('fs.handle.stat', this.handle, options));
    }
  }
  Object.defineProperty(FileHandle, 'name', { value: 'FileHandle' });

  const direct =
    (name: string) =>
    (...args: any[]) =>
      call(`fs.${name}`, ...args.map(input));
  const runtime: any = {
    access: direct('access'),
    appendFile: direct('appendFile'),
    chmod: direct('chmod'),
    chown: direct('chown'),
    copyFile: direct('copyFile'),
    cp: direct('cp'),
    link: direct('link'),
    mkdir: direct('mkdir'),
    mkdtemp: direct('mkdtemp'),
    readlink: direct('readlink'),
    realpath: direct('realpath'),
    rename: direct('rename'),
    rm: direct('rm'),
    rmdir: direct('rmdir'),
    statfs: direct('statfs'),
    symlink: direct('symlink'),
    truncate: direct('truncate'),
    unlink: direct('unlink'),
    utimes: direct('utimes'),
    async readFile(file: any, options?: any) {
      return result(await call('fs.readFile', input(file), options), options);
    },
    async writeFile(file: any, data: any, options?: any) {
      await call('fs.writeFile', input(file), input(data), options);
    },
    async open(file: any, flags: any, mode?: any) {
      const value = await call('fs.open', input(file), flags, mode);
      return new FileHandle(value.handle, value.fd);
    },
    async stat(file: any, options?: any) {
      return new Stats(await call('fs.stat', input(file), options));
    },
    async lstat(file: any, options?: any) {
      return new Stats(await call('fs.lstat', input(file), options));
    },
    async readdir(directory: any, options?: any) {
      const values = await call('fs.readdir', input(directory), options);
      return options?.withFileTypes
        ? values.map((value: any) => new Dirent(value))
        : values.map(binary);
    },
  };
  return runtime;
}
