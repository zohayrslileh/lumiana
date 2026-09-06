import assert from 'assert';
import asyncHooks from './async-hooks.js';
import * as buffer from 'buffer';
import crypto from './crypto.js';
import constants from './constants.js';
import dns, { promises as dnsPromises } from './dns.js';
import EventEmitter from 'events';
import path from './path.js';
import process from './process.js';
import querystring from 'querystring-es3';
import readline, { promises as readlinePromises } from './readline.js';
import stream from 'stream-browserify';
import stringDecoder from 'string_decoder';
import url from './url.js';
import util from './util.js';
import http from './http.js';
import http2 from './http2.js';
import https from './https.js';
import * as net from './net.js';
import streamPromises from './stream-promises.js';
import timers from './timers.js';
import tls from './tls.js';
import zlib from './zlib.js';
import childProcess from './child-process.js';
import fs from './fs.js';
import fsPromises from './fs-promises.js';
import os from './os.js';
import perfHooks from './perf-hooks.js';
import tty from './tty.js';
import v8 from './v8.js';
import vm from './vm.js';
import workerThreads from './worker-threads.js';
import * as sqlite from './sqlite.js';
import { kernelCallSync } from './bridge.js';

const local: Record<string, any> = Object.assign(Object.create(null), {
  assert,
  'assert/strict': assert.strict,
  async_hooks: asyncHooks,
  buffer,
  child_process: childProcess,
  constants,
  crypto,
  dns,
  'dns/promises': dnsPromises,
  events: EventEmitter,
  fs,
  'fs/promises': fsPromises,
  http,
  http2,
  https,
  net,
  os,
  path,
  perf_hooks: perfHooks,
  process,
  querystring,
  readline,
  'readline/promises': readlinePromises,
  stream,
  'stream/promises': streamPromises,
  string_decoder: stringDecoder,
  url,
  util,
  timers,
  tls,
  tty,
  zlib,
  v8,
  vm,
  worker_threads: workerThreads,
  sqlite,
});

const names = new Set([
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'readline/promises',
  'stream',
  'stream/promises',
  'string_decoder',
  'timers',
  'timers/promises',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'sqlite',
  'zlib',
]);

export const builtinModules = Object.freeze([...names].flatMap((name) => [name, `node:${name}`]));

export function isBuiltin(specifier: string): boolean {
  return names.has(specifier.replace(/^node:/, ''));
}

/** Create a CommonJS loader whose resolution remains anchored to the source module. */
export function createRequire(
  _filename: string | URL,
  sourceOrigin?: string,
  unavailable: string[] = [],
): NodeRequire {
  const missing = new Set(unavailable);
  const load = ((specifier: string) => {
    const name = specifier.replace(/^node:/, '');
    if (missing.has(specifier)) {
      const error = new Error(`Cannot find module '${specifier}'`) as Error & { code: string };
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    if (Object.hasOwn(local, name)) return local[name];
    const error = new Error(
      `Dynamic require(${JSON.stringify(specifier)}) cannot be included in the browser bundle`,
    ) as Error & { code: string };
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }) as NodeRequire;
  load.resolve = ((specifier: string, options?: { paths?: string[] }) => {
    if (isBuiltin(specifier)) return specifier;
    return kernelCallSync('module.resolve', specifier, sourceOrigin, options);
  }) as NodeRequire['resolve'];
  load.cache = Object.create(null);
  load.extensions = Object.create(null);
  load.main = undefined;
  return load;
}

export class Module {}

export default { Module, builtinModules, createRequire, isBuiltin };
