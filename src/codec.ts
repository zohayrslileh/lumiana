import { ExtensionCodec, encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';

const extensionCodec = new ExtensionCodec();

const ERROR_EXT_TYPE = 1;
const BIGINT_EXT_TYPE = 2;

extensionCodec.register({
  type: ERROR_EXT_TYPE,
  encode: (error: unknown): Uint8Array | null => {
    if (error instanceof Error) {
      const obj: Record<string, unknown> = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      for (const key of ['code', 'errno', 'syscall', 'path', 'spawnargs']) {
        if (key in error) {
          obj[key] = (error as any)[key];
        }
      }
      return msgpackEncode(obj, { extensionCodec });
    }
    return null;
  },
  decode: (data: Uint8Array) => {
    const obj = msgpackDecode(data, { extensionCodec }) as any;
    const err = new Error(obj?.message || 'Error');
    if (obj) {
      Object.assign(err, obj);
    }
    return err;
  },
});

extensionCodec.register({
  type: BIGINT_EXT_TYPE,
  encode: (val: unknown): Uint8Array | null => {
    if (typeof val === 'bigint') {
      return msgpackEncode(val.toString());
    }
    return null;
  },
  decode: (data: Uint8Array) => BigInt(msgpackDecode(data) as string),
});

export function lumianaEncode(value: unknown): Uint8Array {
  return msgpackEncode(value, { extensionCodec });
}

export function lumianaDecode<T = unknown>(buffer: Uint8Array | ArrayBuffer): T {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return msgpackDecode(bytes, { extensionCodec }) as T;
}

export { extensionCodec };
