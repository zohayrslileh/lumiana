import stream from 'stream-browserify';

export const isatty = (_fd: number) => false;

export class ReadStream extends stream.Readable {
  isRaw = false;
  isTTY = false;
  setRawMode(mode: boolean) {
    this.isRaw = mode;
    return this;
  }
  _read() {
    this.push(null);
  }
}

export class WriteStream extends stream.Writable {
  isTTY = false;
  columns: number | undefined;
  rows: number | undefined;
  getColorDepth() {
    return 1;
  }
  hasColors() {
    return false;
  }
  getWindowSize(): [number, number] {
    return [this.columns ?? 0, this.rows ?? 0];
  }
  _write(_chunk: any, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    done();
  }
}

export default { isatty, ReadStream, WriteStream };
