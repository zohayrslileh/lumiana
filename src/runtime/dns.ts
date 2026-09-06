import { kernelCall, kernelCallSync } from './bridge.js';

type Callback = (error: Error | null, ...values: any[]) => void;

const callback = (promise: Promise<any>, done: Callback, spread?: (value: any) => any[]) => {
  promise.then(
    (value) => done(null, ...(spread ? spread(value) : [value])),
    (error) => done(error),
  );
};

export function lookup(hostname: string, options: any, done?: Callback): void {
  if (typeof options === 'function') [done, options] = [options, undefined];
  if (typeof done !== 'function') throw new TypeError('The callback argument must be a function');
  callback(kernelCall('dns.lookup', hostname, options), done, (value) =>
    options?.all ? [value] : [value.address, value.family],
  );
}

export function lookupService(address: string, port: number, done: Callback): void {
  if (typeof done !== 'function') throw new TypeError('The callback argument must be a function');
  callback(kernelCall('dns.lookupService', address, port), done, (value) => [
    value.hostname,
    value.service,
  ]);
}

export function resolve(hostname: string, rrtype: any, done?: Callback): void {
  if (typeof rrtype === 'function') [done, rrtype] = [rrtype, undefined];
  if (typeof done !== 'function') throw new TypeError('The callback argument must be a function');
  callback(kernelCall('dns.resolve', hostname, rrtype), done);
}

const resolver = (method: string) => (hostname: string, options: any, done?: Callback) => {
  if (typeof options === 'function') [done, options] = [options, undefined];
  if (typeof done !== 'function') throw new TypeError('The callback argument must be a function');
  callback(kernelCall(`dns.${method}`, hostname, options), done);
};

export const resolve4 = resolver('resolve4');
export const resolve6 = resolver('resolve6');
export const resolveAny = resolver('resolveAny');
export const resolveCaa = resolver('resolveCaa');
export const resolveCname = resolver('resolveCname');
export const resolveMx = resolver('resolveMx');
export const resolveNaptr = resolver('resolveNaptr');
export const resolveNs = resolver('resolveNs');
export const resolvePtr = resolver('resolvePtr');
export const resolveSoa = resolver('resolveSoa');
export const resolveSrv = resolver('resolveSrv');
export const resolveTxt = resolver('resolveTxt');
export const reverse = resolver('reverse');

export const getDefaultResultOrder = () => kernelCallSync('dns.getDefaultResultOrder');
export const setDefaultResultOrder = (order: string) =>
  kernelCallSync('dns.setDefaultResultOrder', order);
export const getServers = () => kernelCallSync('dns.getServers');
export const setServers = (servers: readonly string[]) => kernelCallSync('dns.setServers', servers);

const promise =
  (method: string) =>
  (...args: any[]) =>
    kernelCall(`dns.${method}`, ...args);
export const promises = {
  getDefaultResultOrder,
  getServers,
  lookup: promise('lookup'),
  lookupService: promise('lookupService'),
  resolve: promise('resolve'),
  resolve4: promise('resolve4'),
  resolve6: promise('resolve6'),
  resolveAny: promise('resolveAny'),
  resolveCaa: promise('resolveCaa'),
  resolveCname: promise('resolveCname'),
  resolveMx: promise('resolveMx'),
  resolveNaptr: promise('resolveNaptr'),
  resolveNs: promise('resolveNs'),
  resolvePtr: promise('resolvePtr'),
  resolveSoa: promise('resolveSoa'),
  resolveSrv: promise('resolveSrv'),
  resolveTxt: promise('resolveTxt'),
  reverse: promise('reverse'),
  setDefaultResultOrder,
  setServers,
};

export const ADDRCONFIG = 32;
export const V4MAPPED = 8;
export const ALL = 16;

const runtime = {
  ADDRCONFIG,
  ALL,
  V4MAPPED,
  getDefaultResultOrder,
  getServers,
  lookup,
  lookupService,
  promises,
  resolve,
  resolve4,
  resolve6,
  resolveAny,
  resolveCaa,
  resolveCname,
  resolveMx,
  resolveNaptr,
  resolveNs,
  resolvePtr,
  resolveSoa,
  resolveSrv,
  resolveTxt,
  reverse,
  setDefaultResultOrder,
  setServers,
};

export default runtime;
