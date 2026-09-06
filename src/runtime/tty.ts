import stream from 'stream-browserify';
import { Buffer } from 'buffer';
import { kernelCall, kernelCallSync, kernelSubscribe } from './bridge.js';

export const isatty = (fd: number) => kernelCallSync('fs.isatty', fd);

const error = (value: any) => Object.assign(new Error(value.message), value);

export class ReadStream extends stream.Readable {
  isRaw = false;
  isTTY = true;
  private handle?: number;
  private release?: () => void;
  private pendingRead = false;

  constructor(
    readonly fd: number,
    options: any = {},
  ) {
    super({ ...options, emitClose: true });
    void kernelCall('fs.fd.readStream', fd).then(
      (handle) => {
        this.handle = handle;
        this.release = kernelSubscribe(handle, (event, args) => {
          if (event === 'data') {
            if (!this.push(Buffer.from(args[0])))
              void kernelCall('fs.fd.readStream.pause', handle).catch((error) =>
                this.destroy(error),
              );
          } else if (event === 'end') this.push(null);
          else if (event === 'error') this.destroy(error(args[0]));
          else if (event === 'close') {
            this.release?.();
            if (!this.destroyed) this.destroy();
          }
        });
        void kernelCall('fs.fd.readStream.attach', handle).catch((error) => this.destroy(error));
        if (this.destroyed) void kernelCall('fs.fd.readStream.destroy', handle).catch(() => {});
        else if (this.pendingRead)
          void kernelCall('fs.fd.readStream.resume', handle).catch((error) => this.destroy(error));
      },
      (reason) => this.destroy(reason),
    );
  }

  setRawMode(mode: boolean) {
    this.isRaw = mode;
    return this;
  }

  _read() {
    this.pendingRead = true;
    if (this.handle !== undefined)
      void kernelCall('fs.fd.readStream.resume', this.handle).catch((error) => this.destroy(error));
  }

  override destroy(error?: Error) {
    if (this.handle !== undefined)
      void kernelCall('fs.fd.readStream.destroy', this.handle).catch(() => {});
    return super.destroy(error);
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
