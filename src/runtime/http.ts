import { STATUS_CODES } from './http-status.js';
export { STATUS_CODES };
import { createAgent } from './http-agent.js';
import { kernelCall, kernelSubscribe } from './bridge.js';
import { createHttp } from './http-core.js';
import { createHttpClient } from './http-client.js';
import { network } from './socket-runtime.js';

export const httpRuntime = createHttp(kernelCall, kernelSubscribe, network);
const runtime = httpRuntime;
export const Agent = createAgent(network.createConnection);
export const globalAgent = new Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 });

export const httpClient = createHttpClient(kernelCall, kernelSubscribe, {
  protocol: 'http:',
  defaultPort: 80,
  createConnection: network.createConnection,
  globalAgent,
});

export const { ClientRequest, request, get } = httpClient;

export const { Server, IncomingMessage, ServerResponse, createServer } = runtime;

export const METHODS = Object.freeze([
  'ACL',
  'BIND',
  'CHECKOUT',
  'CONNECT',
  'COPY',
  'DELETE',
  'GET',
  'HEAD',
  'LINK',
  'LOCK',
  'M-SEARCH',
  'MERGE',
  'MKACTIVITY',
  'MKCALENDAR',
  'MKCOL',
  'MOVE',
  'NOTIFY',
  'OPTIONS',
  'PATCH',
  'POST',
  'PROPFIND',
  'PROPPATCH',
  'PURGE',
  'PUT',
  'REBIND',
  'REPORT',
  'SEARCH',
  'SOURCE',
  'SUBSCRIBE',
  'TRACE',
  'UNBIND',
  'UNLINK',
  'UNLOCK',
  'UNSUBSCRIBE',
]);

export const maxHeaderSize = 16 * 1024;

export function validateHeaderName(name: string): void {
  if (typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
    const error = new TypeError(`Header name must be a valid HTTP token [${name}]`);
    Object.assign(error, { code: 'ERR_INVALID_HTTP_TOKEN' });
    throw error;
  }
}

export function validateHeaderValue(name: string, value: unknown): void {
  if (value === undefined || /[\0\r\n]/.test(String(value))) {
    const error = new TypeError(`Invalid value ${String(value)} for header ${name}`);
    Object.assign(error, { code: 'ERR_INVALID_CHAR' });
    throw error;
  }
}

export default {
  ClientRequest,
  request,
  get,
  Agent,
  IncomingMessage,
  METHODS,
  STATUS_CODES,
  Server,
  ServerResponse,
  createServer,
  globalAgent,
  maxHeaderSize,
  validateHeaderName,
  validateHeaderValue,
};
