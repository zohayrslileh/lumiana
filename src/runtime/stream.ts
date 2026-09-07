import stream from 'stream-browserify';

const defineState = (prototype: object, name: string, read: (value: any) => unknown) => {
  if (name in prototype) return;
  Object.defineProperty(prototype, name, {
    configurable: true,
    enumerable: false,
    get() {
      return read(this);
    },
  });
};

const readable = (value: any) => value._readableState;
const writable = (value: any) => value._writableState;

for (const [name, read] of Object.entries({
  readableAborted: (value: any) => Boolean(value.destroyed && !readable(value)?.endEmitted),
  readableDidRead: (value: any) => Boolean(readable(value)?.dataEmitted),
  readableEncoding: (value: any) => readable(value)?.decoder?.encoding ?? null,
  readableEnded: (value: any) => Boolean(readable(value)?.endEmitted),
  readableObjectMode: (value: any) => Boolean(readable(value)?.objectMode),
  closed: (value: any) => Boolean(readable(value)?.closeEmitted),
}))
  defineState(stream.Readable.prototype, name, read);

for (const [name, read] of Object.entries({
  writableAborted: (value: any) => Boolean(value.destroyed && !writable(value)?.finished),
  writableCorked: (value: any) => writable(value)?.corked ?? 0,
  writableEnded: (value: any) => Boolean(writable(value)?.ending),
  writableFinished: (value: any) => Boolean(writable(value)?.finished),
  writableNeedDrain: (value: any) => Boolean(writable(value)?.needDrain),
  writableObjectMode: (value: any) => Boolean(writable(value)?.objectMode),
  closed: (value: any) => Boolean(writable(value)?.closeEmitted),
}))
  defineState(stream.Writable.prototype, name, read);

export const { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished } =
  stream;

export default stream;
