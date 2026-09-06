import { EventEmitter } from 'events';
import { kernelCall, kernelSubscribe } from './bridge.js';
import { createHttp } from './http-core.js';
import { createHttpClient } from './http-client.js';

const runtime = createHttp(kernelCall, kernelSubscribe);
export const { ClientRequest, request, get } = createHttpClient(kernelCall, kernelSubscribe);

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

export const STATUS_CODES: Record<number, string> = Object.freeze({
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  418: "I'm a Teapot",
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
});

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

export class Agent extends EventEmitter {
  defaultPort = 80;
  protocol = 'http:';
  options: Record<string, unknown>;
  requests = Object.create(null);
  sockets = Object.create(null);
  freeSockets = Object.create(null);
  maxSockets: number;
  maxFreeSockets: number;
  keepAlive: boolean;
  keepAliveMsecs: number;
  maxTotalSockets: number;
  totalSocketCount = 0;
  constructor(options: any = {}) {
    super();
    this.options = { ...options };
    this.keepAlive = Boolean(options.keepAlive);
    this.keepAliveMsecs = options.keepAliveMsecs ?? 1000;
    this.maxSockets = options.maxSockets ?? Infinity;
    this.maxFreeSockets = options.maxFreeSockets ?? 256;
    this.maxTotalSockets = options.maxTotalSockets ?? Infinity;
  }
  destroy() {}
}

export const globalAgent = new Agent();

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
