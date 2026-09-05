import { nativeRequire } from './bridge.js';

const call = (name: string, args: any[]) => {
  const fn = nativeRequire('node:tls', undefined, [name]);
  return Reflect.apply(fn, undefined, args);
};

export const connect = (...args: any[]) => call('connect', args);
export const createServer = (...args: any[]) => call('createServer', args);
export default { connect, createServer };
