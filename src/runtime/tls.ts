import { unsupported } from './unsupported.js';

const call = (name: string, args: any[]) => {
  return unsupported('node:tls', name);
};

export const connect = (...args: any[]) => call('connect', args);
export const createServer = (...args: any[]) => call('createServer', args);
export default { connect, createServer };
