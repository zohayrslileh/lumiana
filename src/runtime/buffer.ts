import buffer, { Buffer } from 'buffer/index.js';

const prototype = Buffer.prototype as any;
const encodings: Record<string, BufferEncoding> = {
  ascii: 'ascii',
  base64: 'base64',
  base64url: 'base64url',
  latin1: 'latin1',
  hex: 'hex',
  ucs2: 'utf16le',
  utf8: 'utf8',
};

for (const [name, encoding] of Object.entries(encodings)) {
  const slice = `${name}Slice`;
  if (typeof prototype[slice] !== 'function')
    Object.defineProperty(prototype, slice, {
      configurable: true,
      enumerable: true,
      writable: true,
      value(this: Buffer, start?: number, end?: number) {
        return this.toString(encoding, start, end);
      },
    });

  const write = `${name}Write`;
  if (typeof prototype[write] !== 'function')
    Object.defineProperty(prototype, write, {
      configurable: true,
      enumerable: true,
      writable: true,
      value(this: Buffer, value: string, offset = 0, length = this.length - offset) {
        return this.write(value, offset, length, encoding);
      },
    });
}

export { Buffer };
export const INSPECT_MAX_BYTES = (buffer as any).INSPECT_MAX_BYTES;
export const SlowBuffer = (buffer as any).SlowBuffer;
export const kMaxLength = (buffer as any).kMaxLength;
export default buffer;
