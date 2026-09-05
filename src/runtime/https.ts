import { unsupported } from './unsupported.js';

const call = (name: string, args: any[]) => {
  return unsupported('node:https', name);
};

export const createServer = (...args: any[]) => call('createServer', args);
export const request = (...args: any[]) => call('request', args);
export const get = (...args: any[]) => call('get', args);
export default { createServer, get, request };
