import fs, { type FileHandle } from 'node:fs/promises';

type FileType =
  | 'file'
  | 'directory'
  | 'blockDevice'
  | 'characterDevice'
  | 'symbolicLink'
  | 'fifo'
  | 'socket'
  | 'unknown';

const fileType = (value: {
  isFile(): boolean;
  isDirectory(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isSymbolicLink(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}): FileType => {
  if (value.isFile()) return 'file';
  if (value.isDirectory()) return 'directory';
  if (value.isBlockDevice()) return 'blockDevice';
  if (value.isCharacterDevice()) return 'characterDevice';
  if (value.isSymbolicLink()) return 'symbolicLink';
  if (value.isFIFO()) return 'fifo';
  if (value.isSocket()) return 'socket';
  return 'unknown';
};

const statRecord = (stat: any) => ({
  type: fileType(stat),
  dev: stat.dev,
  ino: stat.ino,
  mode: stat.mode,
  nlink: stat.nlink,
  uid: stat.uid,
  gid: stat.gid,
  rdev: stat.rdev,
  size: stat.size,
  blksize: stat.blksize,
  blocks: stat.blocks,
  atimeMs: stat.atimeMs,
  mtimeMs: stat.mtimeMs,
  ctimeMs: stat.ctimeMs,
  birthtimeMs: stat.birthtimeMs,
});

const directoryRecord = (entry: any) => ({
  type: fileType(entry),
  name: entry.name,
  parentPath: entry.parentPath ?? entry.path,
});

/** Per-connection host filesystem. JavaScript values never escape through this contract. */
export class FileKernel {
  private sequence = 0;
  private handles = new Map<number, FileHandle>();

  async close(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    await Promise.allSettled(handles.map((handle) => handle.close()));
  }

  private handle(id: number): FileHandle {
    const handle = this.handles.get(id);
    if (!handle) throw new ReferenceError(`Unknown file handle ${id}`);
    return handle;
  }

  async execute(operation: string, args: any[]): Promise<any> {
    switch (operation) {
      case 'fs.open': {
        const handle = await fs.open(args[0], args[1], args[2]);
        const id = ++this.sequence;
        this.handles.set(id, handle);
        return { handle: id, fd: handle.fd };
      }
      case 'fs.handle.close': {
        const id = Number(args[0]);
        const handle = this.handle(id);
        this.handles.delete(id);
        await handle.close();
        return undefined;
      }
      case 'fs.handle.readFile':
        return this.handle(Number(args[0])).readFile(args[1]);
      case 'fs.handle.writeFile':
        await this.handle(Number(args[0])).writeFile(args[1], args[2]);
        return undefined;
      case 'fs.handle.appendFile':
        await this.handle(Number(args[0])).appendFile(args[1], args[2]);
        return undefined;
      case 'fs.handle.truncate':
        await this.handle(Number(args[0])).truncate(args[1]);
        return undefined;
      case 'fs.handle.sync':
        await this.handle(Number(args[0])).sync();
        return undefined;
      case 'fs.handle.datasync':
        await this.handle(Number(args[0])).datasync();
        return undefined;
      case 'fs.handle.stat':
        return statRecord(await this.handle(Number(args[0])).stat(args[1]));
      case 'fs.readFile':
        return fs.readFile(args[0], args[1]);
      case 'fs.writeFile':
        await fs.writeFile(args[0], args[1], args[2]);
        return undefined;
      case 'fs.appendFile':
        await fs.appendFile(args[0], args[1], args[2]);
        return undefined;
      case 'fs.access':
        await fs.access(args[0], args[1]);
        return undefined;
      case 'fs.chmod':
        await fs.chmod(args[0], args[1]);
        return undefined;
      case 'fs.chown':
        await fs.chown(args[0], args[1], args[2]);
        return undefined;
      case 'fs.copyFile':
        await fs.copyFile(args[0], args[1], args[2]);
        return undefined;
      case 'fs.cp':
        await fs.cp(args[0], args[1], args[2]);
        return undefined;
      case 'fs.link':
        await fs.link(args[0], args[1]);
        return undefined;
      case 'fs.lstat':
        return statRecord(await fs.lstat(args[0], args[1]));
      case 'fs.mkdir':
        return fs.mkdir(args[0], args[1]);
      case 'fs.mkdtemp':
        return fs.mkdtemp(args[0], args[1]);
      case 'fs.readlink':
        return fs.readlink(args[0], args[1]);
      case 'fs.realpath':
        return fs.realpath(args[0], args[1]);
      case 'fs.readdir': {
        const entries = await fs.readdir(args[0], args[1]);
        return args[1]?.withFileTypes ? entries.map(directoryRecord) : entries;
      }
      case 'fs.rename':
        await fs.rename(args[0], args[1]);
        return undefined;
      case 'fs.rm':
        await fs.rm(args[0], args[1]);
        return undefined;
      case 'fs.rmdir':
        await fs.rmdir(args[0], args[1]);
        return undefined;
      case 'fs.stat':
        return statRecord(await fs.stat(args[0], args[1]));
      case 'fs.statfs':
        return { ...(await fs.statfs(args[0], args[1])) };
      case 'fs.symlink':
        await fs.symlink(args[0], args[1], args[2]);
        return undefined;
      case 'fs.truncate':
        await fs.truncate(args[0], args[1]);
        return undefined;
      case 'fs.unlink':
        await fs.unlink(args[0]);
        return undefined;
      case 'fs.utimes':
        await fs.utimes(args[0], args[1], args[2]);
        return undefined;
      default:
        throw new TypeError(`Unknown filesystem operation ${operation}`);
    }
  }
}
