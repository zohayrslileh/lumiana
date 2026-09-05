import { nativeRequire } from './bridge.js';

const call = (name: string, args: any[]) => {
  const fn = nativeRequire('node:https', undefined, [name]);
  return Reflect.apply(fn, undefined, args);
};

export const createServer = (...args: any[]) => call('createServer', args);
export const request = (...args: any[]) => call('request', args);
export const get = (...args: any[]) => call('get', args);
export default { createServer, get, request };
