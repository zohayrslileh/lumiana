import { Buffer } from 'buffer';
import hpack from 'hpack.js';

export const PREFACE = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');
export const settingsIds: Record<string, number> = {
  headerTableSize: 1,
  enablePush: 2,
  maxConcurrentStreams: 3,
  initialWindowSize: 4,
  maxFrameSize: 5,
  maxHeaderListSize: 6,
  enableConnectProtocol: 8,
};
export const defaultSettings = {
  headerTableSize: 4096,
  enablePush: true,
  initialWindowSize: 65535,
  maxFrameSize: 16384,
  maxConcurrentStreams: 0xffffffff,
  maxHeaderListSize: 65535,
  enableConnectProtocol: false,
};
export const sensitiveHeaders = Symbol.for('nodejs.http2.sensitiveHeaders');
export const h2error = (message: string, code = 'ERR_HTTP2_ERROR') =>
  Object.assign(new Error(message), { code });
export function frame(type: number, flags: number, id: number, payload: Buffer = Buffer.alloc(0)) {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(id & 0x7fffffff, 5);
  return Buffer.concat([header, payload]);
}
export function getPackedSettings(settings: any = {}) {
  const entries = Object.entries(settings)
    .filter(([name]) => settingsIds[name])
    .sort(([a], [b]) => settingsIds[a] - settingsIds[b]);
  const bytes = Buffer.alloc(entries.length * 6);
  entries.forEach(([name, raw], index) => {
    const value = typeof raw === 'boolean' ? Number(raw) : (raw as number);
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 0xffffffff ||
      (name === 'initialWindowSize' && value > 0x7fffffff) ||
      (name === 'maxFrameSize' && (value < 16384 || value > 0xffffff)) ||
      (['enablePush', 'enableConnectProtocol'].includes(name) && value !== 0 && value !== 1)
    )
      throw new RangeError(`Invalid HTTP/2 setting ${name}`);
    bytes.writeUInt16BE(settingsIds[name], index * 6);
    bytes.writeUInt32BE(value, index * 6 + 2);
  });
  return bytes;
}
export function getUnpackedSettings(input: Uint8Array, options?: { validate?: boolean }) {
  const bytes = Buffer.from(input);
  if (bytes.length % 6) throw new RangeError('HTTP/2 settings length must be a multiple of six');
  const result: any = {};
  for (let offset = 0; offset < bytes.length; offset += 6) {
    const name = Object.keys(settingsIds).find(
      (key) => settingsIds[key] === bytes.readUInt16BE(offset),
    );
    if (name) {
      const value = bytes.readUInt32BE(offset + 2);
      if (options?.validate) getPackedSettings({ [name]: value });
      result[name] = ['enablePush', 'enableConnectProtocol'].includes(name) ? value !== 0 : value;
    }
  }
  if (options?.validate) getPackedSettings(result);
  return result;
}
export function headerPairs(headers: any): { name: string; value: string; neverIndex: boolean }[] {
  const result: { name: string; value: string; neverIndex: boolean }[] = [];
  for (const name of Object.keys(headers).sort(
    (a, b) => Number(b.startsWith(':')) - Number(a.startsWith(':')),
  )) {
    if (name !== name.toLowerCase() || !/^:?[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name))
      throw h2error(`Invalid HTTP/2 header ${name}`, 'ERR_INVALID_HTTP_TOKEN');
    if (
      ['connection', 'upgrade', 'keep-alive', 'proxy-connection', 'transfer-encoding'].includes(
        name,
      )
    )
      throw h2error(
        `Connection-specific header ${name} is not valid in HTTP/2`,
        'ERR_HTTP2_INVALID_CONNECTION_HEADERS',
      );
    if (headers[name] === undefined) continue;
    for (const value of Array.isArray(headers[name]) ? headers[name] : [headers[name]]) {
      if (/[\0\r\n]/.test(String(value))) throw h2error('Invalid HTTP/2 header value');
      if (name === 'te' && value !== 'trailers') throw h2error('HTTP/2 TE must be trailers');
      result.push({
        name,
        value: String(value),
        neverIndex: name === 'authorization' || headers[sensitiveHeaders]?.includes(name),
      });
    }
  }
  return result;
}
export class HeaderCodec {
  private compressor = hpack.compressor.create({ table: { maxSize: 4096 } });
  private decompressor = hpack.decompressor.create({ table: { maxSize: 0xffffffff } });
  private receiveTableSize = 4096;
  private tableUpdate?: number;
  private error?: Error;
  constructor() {
    this.decompressor.updateTableSize(4096);
    this.compressor.on('error', (error: Error) => (this.error = error));
    this.decompressor.on('error', (error: Error) => (this.error = error));
  }
  setSendTableSize(size: number) {
    const capacity = Math.min(size, 4096);
    this.compressor = hpack.compressor.create({ table: { maxSize: capacity } });
    this.compressor.on('error', (error: Error) => (this.error = error));
    this.tableUpdate = capacity;
  }
  setReceiveTableSize(size: number) {
    this.receiveTableSize = size;
    this.decompressor.updateTableSize(size);
  }
  encode(headers: any) {
    this.compressor.write(headerPairs(headers));
    if (this.error) throw this.error;
    const chunks: Buffer[] = [];
    let chunk;
    while ((chunk = this.compressor.read()) !== null) chunks.push(Buffer.from(chunk));
    if (this.tableUpdate !== undefined) {
      const size = this.tableUpdate;
      this.tableUpdate = undefined;
      const update = (value: number) => {
        const bytes = [0x20 | Math.min(value, 31)];
        if (value >= 31) {
          value -= 31;
          while (value >= 128) {
            bytes.push((value % 128) | 128);
            value = Math.floor(value / 128);
          }
          bytes.push(value);
        }
        return Buffer.from(bytes);
      };
      chunks.unshift(update(0), update(size));
    }
    return Buffer.concat(chunks);
  }
  decode(bytes: Buffer, maxSize: number) {
    let offset = 0;
    while (offset < bytes.length && (bytes[offset] & 0xe0) === 0x20) {
      let size = bytes[offset++] & 31;
      if (size === 31) {
        let shift = 0,
          value;
        do {
          if (offset >= bytes.length || shift > 28) throw h2error('Invalid HPACK table update');
          value = bytes[offset++];
          size += (value & 127) * 2 ** shift;
          shift += 7;
        } while (value & 128);
      }
      if (size > this.receiveTableSize) throw h2error('HPACK table exceeds negotiated capacity');
    }
    this.decompressor.write(bytes);
    this.decompressor.execute();
    if (this.error) throw this.error;
    const headers: any = Object.create(null),
      raw: string[] = [];
    let header,
      size = 0,
      regular = false;
    while ((header = this.decompressor.read()) !== null) {
      const { name, value } = header;
      size += Buffer.byteLength(name) + Buffer.byteLength(value) + 32;
      if (size > maxSize) throw h2error('HTTP/2 header list exceeds negotiated limit');
      if (name.startsWith(':') && (regular || headers[name] !== undefined))
        throw h2error('Invalid HTTP/2 pseudo-header order');
      if (!name.startsWith(':')) regular = true;
      headerPairs({ [name]: value });
      raw.push(name, value);
      if (name === 'set-cookie') (headers[name] ??= []).push(value);
      else
        headers[name] =
          headers[name] === undefined
            ? value
            : headers[name] + (name === 'cookie' ? '; ' : ', ') + value;
    }
    if (headers[':status'] !== undefined) headers[':status'] = Number(headers[':status']);
    return { headers, raw };
  }
}
