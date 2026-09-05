import { nativeRequire } from './bridge.js';

const call = (name: string, args: any[]) => {
  const fn = nativeRequire('node:http2', undefined, [name]);
  return Reflect.apply(fn, undefined, args);
};

export const createServer = (...args: any[]) => call('createServer', args);
export const createSecureServer = (...args: any[]) => call('createSecureServer', args);
export const connect = (...args: any[]) => call('connect', args);
export default { connect, createSecureServer, createServer };
