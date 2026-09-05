import { unsupported } from './unsupported.js';

const call = (name: string, args: any[]) => {
  return unsupported('node:http2', name);
};

export const createServer = (...args: any[]) => call('createServer', args);
export const createSecureServer = (...args: any[]) => call('createSecureServer', args);
export const connect = (...args: any[]) => call('connect', args);
export default { connect, createSecureServer, createServer };
