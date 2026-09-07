import browserCrypto from 'crypto-browserify';
import { Buffer } from './buffer.js';

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
  createDiffieHellmanGroup,
  createHash,
  getCiphers,
  getDiffieHellman,
  getHashes,
  pbkdf2,
  pbkdf2Sync,
  privateDecrypt,
  privateEncrypt,
  publicDecrypt,
  publicEncrypt,
} = browserCrypto as any;
const localCreateHmac = (browserCrypto as any).createHmac;

const nativeExport = (name: string): any => {
  const load = (globalThis as any)[Symbol.for('lumiana.runtime')]?.nativeExport;
  if (typeof load !== 'function')
    throw new Error('Lumiana is not connected. Call await connect.credentials() first.');
  return load('node:crypto', name);
};

const nativeFunction = (name: string) =>
  function (this: any, ...args: any[]) {
    return Reflect.apply(nativeExport(name), undefined, args);
  };

/** Local constructor identity for key resources retained by the engine. */
export class KeyObject {
  constructor(...args: any[]) {
    return Reflect.construct(nativeExport('KeyObject'), args);
  }

  static [Symbol.hasInstance](value: any): boolean {
    return value instanceof nativeExport('KeyObject');
  }
}

// These APIs depend on OpenSSL key objects or native constant-time operations.
// Their functions stay local references while each invocation executes in the engine.
export const createPrivateKey = nativeFunction('createPrivateKey');
export const createPublicKey = nativeFunction('createPublicKey');
export const createSecretKey = nativeFunction('createSecretKey');
export const createSign = nativeFunction('createSign');
export const createVerify = nativeFunction('createVerify');
export const diffieHellman = nativeFunction('diffieHellman');
export const generateKey = nativeFunction('generateKey');
export const generateKeyPair = nativeFunction('generateKeyPair');
export const generateKeyPairSync = nativeFunction('generateKeyPairSync');
export const generateKeySync = nativeFunction('generateKeySync');
export const getCurves = nativeFunction('getCurves');
export const sign = nativeFunction('sign');
export const timingSafeEqual = nativeFunction('timingSafeEqual');
export const verify = nativeFunction('verify');

export function createHmac(algorithm: string, key: any, options?: any): any {
  if (typeof key === 'string' || key instanceof ArrayBuffer || ArrayBuffer.isView(key))
    return Reflect.apply(localCreateHmac, browserCrypto, [algorithm, key, options]);
  if (key instanceof KeyObject)
    return Reflect.apply(nativeExport('createHmac'), undefined, [algorithm, key, options]);
  return Reflect.apply(localCreateHmac, browserCrypto, [algorithm, key, options]);
}

export default {
  ...(browserCrypto as any),
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  createSign,
  createVerify,
  diffieHellman,
  generateKey,
  generateKeyPair,
  generateKeyPairSync,
  generateKeySync,
  getCurves,
  KeyObject,
  randomBytes,
  randomFill,
  randomFillSync,
  randomUUID,
  sign,
  timingSafeEqual,
  verify,
};
