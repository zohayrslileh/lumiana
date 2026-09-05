import browserCrypto from 'crypto-browserify';
import { Buffer } from 'buffer';

const webCrypto = globalThis.crypto;

function fillBytes(view: ArrayBufferView, offset = 0, size = view.byteLength - offset): void {
  if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0)
    throw new RangeError('offset and size must be non-negative integers');
  if (offset + size > view.byteLength) throw new RangeError('offset + size exceeds buffer length');
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, size);
  for (let start = 0; start < bytes.byteLength; start += 65_536)
    webCrypto.getRandomValues(bytes.subarray(start, Math.min(start + 65_536, bytes.byteLength)));
}

export function randomFillSync<T extends ArrayBufferView>(
  buffer: T,
  offset = 0,
  size = buffer.byteLength - offset,
): T {
  fillBytes(buffer, offset, size);
  return buffer;
}

export function randomFill<T extends ArrayBufferView>(
  buffer: T,
  offset?: number | ((error: Error | null, buffer: T) => void),
  size?: number | ((error: Error | null, buffer: T) => void),
  callback?: (error: Error | null, buffer: T) => void,
): void {
  if (typeof offset === 'function') callback = offset;
  else if (typeof size === 'function') callback = size;
  if (typeof callback !== 'function')
    throw new TypeError('The "callback" argument must be of type function');
  queueMicrotask(() => {
    try {
      randomFillSync(
        buffer,
        typeof offset === 'number' ? offset : 0,
        typeof size === 'number' ? size : undefined,
      );
      callback(null, buffer);
    } catch (error) {
      callback(error as Error, buffer);
    }
  });
}

export function randomBytes(
  size: number,
  callback?: (error: Error | null, value: Buffer) => void,
): Buffer | void {
  const value = Buffer.allocUnsafe(size);
  if (!callback) return randomFillSync(value);
  queueMicrotask(() => {
    try {
      callback(null, randomFillSync(value));
    } catch (error) {
      callback(error as Error, value);
    }
  });
}

export const randomUUID = webCrypto.randomUUID.bind(webCrypto);
export const {
  createCipher,
  createCipheriv,
  createCredentials,
  createDecipher,
  createDecipheriv,
  createDiffieHellman,
  createECDH,
  createHash,
  createHmac,
  getCiphers,
  getCurves,
  getDiffieHellman,
  getHashes,
  pbkdf2,
  pbkdf2Sync,
  privateDecrypt,
  privateEncrypt,
  publicDecrypt,
  publicEncrypt,
  sign,
  verify,
} = browserCrypto as any;

export default {
  ...(browserCrypto as any),
  randomBytes,
  randomFill,
  randomFillSync,
  randomUUID,
};
