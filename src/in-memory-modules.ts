/**
 * Pure in-memory implementations of Node.js modules running in browser memory at 0ms latency.
 * These are injected into Vite when bundling or importing Node built-in modules.
 */

export const IN_MEMORY_PATH_CODE = `
function normalizeStringPosix(path, allowAboveRoot) {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (code === 47) break;
    else code = 47;

    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf('/');
            if (lastSlashIndex !== -1) {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf('/');
              lastSlash = i;
              dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) res += '/..';
          else res = '..';
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += '/' + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

export function isAbsolute(path) {
  return typeof path === 'string' && path.length > 0 && path.charCodeAt(0) === 47;
}

export function normalize(path) {
  if (typeof path !== 'string') throw new TypeError('Path must be a string. Received ' + JSON.stringify(path));
  if (path.length === 0) return '.';
  const isAbs = path.charCodeAt(0) === 47;
  const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
  let res = normalizeStringPosix(path, !isAbs);
  if (res.length === 0 && !isAbs) res = '.';
  if (res.length > 0 && trailingSeparator) res += '/';
  if (isAbs) return '/' + res;
  return res;
}

export function join(...paths) {
  if (paths.length === 0) return '.';
  let joined;
  for (let i = 0; i < paths.length; ++i) {
    const arg = paths[i];
    if (typeof arg !== 'string') throw new TypeError('Path must be a string. Received ' + JSON.stringify(arg));
    if (arg.length > 0) {
      if (joined === undefined) joined = arg;
      else joined += '/' + arg;
    }
  }
  if (joined === undefined) return '.';
  return normalize(joined);
}

export function resolve(...paths) {
  let resolvedPath = '';
  let resolvedAbsolute = false;
  for (let i = paths.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    let path = i >= 0 ? paths[i] : (typeof process !== 'undefined' && process.cwd ? process.cwd() : '/');
    if (typeof path !== 'string') throw new TypeError('Path must be a string. Received ' + JSON.stringify(path));
    if (path.length === 0) continue;
    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charCodeAt(0) === 47;
  }
  resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);
  if (resolvedAbsolute) {
    return '/' + resolvedPath;
  } else if (resolvedPath.length > 0) {
    return resolvedPath;
  }
  return '.';
}

export function relative(from, to) {
  if (typeof from !== 'string') throw new TypeError('from must be a string');
  if (typeof to !== 'string') throw new TypeError('to must be a string');
  if (from === to) return '';
  const fromOrig = resolve(from);
  const toOrig = resolve(to);
  if (fromOrig === toOrig) return '';
  const fromParts = fromOrig.split('/').filter(Boolean);
  const toParts = toOrig.split('/').filter(Boolean);
  let length = Math.min(fromParts.length, toParts.length);
  let samePartsLength = length;
  for (let i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }
  let outputParts = [];
  for (let i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }
  outputParts = outputParts.concat(toParts.slice(samePartsLength));
  return outputParts.join('/');
}

export function dirname(path) {
  if (typeof path !== 'string') throw new TypeError('Path must be a string');
  if (path.length === 0) return '.';
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

export function basename(path, ext) {
  if (typeof path !== 'string') throw new TypeError('Path must be a string');
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return '';
  let res = path.slice(start, end);
  if (ext && res.endsWith(ext) && res.length > ext.length) {
    res = res.slice(0, res.length - ext.length);
  }
  return res;
}

export function extname(path) {
  if (typeof path !== 'string') throw new TypeError('Path must be a string');
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
    return '';
  }
  return path.slice(startDot, end);
}

export function format(pathObject) {
  if (pathObject === null || typeof pathObject !== 'object') throw new TypeError('Parameter "pathObject" must be an object');
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '');
  if (!dir) return base;
  if (dir === pathObject.root) return dir + base;
  return dir + '/' + base;
}

export function parse(path) {
  if (typeof path !== 'string') throw new TypeError('Path must be a string');
  const ret = { root: '', dir: '', base: '', ext: '', name: '' };
  if (path.length === 0) return ret;
  const isAbs = path.charCodeAt(0) === 47;
  let start;
  if (isAbs) {
    ret.root = '/';
    start = 1;
  } else {
    start = 0;
  }
  ret.base = basename(path);
  ret.ext = extname(path);
  ret.name = ret.base.slice(0, ret.base.length - ret.ext.length);
  ret.dir = dirname(path);
  return ret;
}

export const sep = '/';
export const delimiter = ':';
const _path = {
  resolve,
  normalize,
  isAbsolute,
  join,
  relative,
  dirname,
  basename,
  extname,
  format,
  parse,
  sep,
  delimiter,
};
_path.posix = _path;
_path.win32 = _path;
export const posix = _path;
export const win32 = _path;
export default _path;
`;

export const IN_MEMORY_EVENTS_CODE = `
export function EventEmitter() {
  if (this._events === undefined || this._events === Object.getPrototypeOf(this)?._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }
  this._maxListeners = this._maxListeners || undefined;
}

EventEmitter.EventEmitter = EventEmitter;
EventEmitter.default = EventEmitter;
EventEmitter.defaultMaxListeners = 10;

EventEmitter.init = function() {
  if (this._events === undefined || this._events === Object.getPrototypeOf(this)?._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }
  this._maxListeners = this._maxListeners || undefined;
};

EventEmitter.listenerCount = (emitter, type) => (emitter && typeof emitter.listenerCount === 'function' ? emitter.listenerCount(type) : 0);

EventEmitter.prototype.setMaxListeners = function(n) {
  if (typeof n !== 'number' || n < 0 || Number.isNaN(n)) {
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number.');
  }
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.getMaxListeners = function() {
  return this._maxListeners !== undefined ? this._maxListeners : EventEmitter.defaultMaxListeners;
};

EventEmitter.prototype.emit = function(type, ...args) {
  let doError = type === 'error';
  const events = this._events;
  if (events !== undefined) {
    doError = doError && events.error === undefined;
  } else if (!doError) {
    return false;
  }

  if (doError) {
    let er;
    if (args.length > 0) er = args[0];
    if (er instanceof Error) {
      throw er;
    }
    const err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
    err.context = er;
    throw err;
  }

  if (!events) return false;
  const handler = events[type];
  if (handler === undefined) return false;

  if (typeof handler === 'function') {
    Reflect.apply(handler, this, args);
    return true;
  }

  const len = handler.length;
  const listeners = handler.slice();
  for (let i = 0; i < len; ++i) {
    Reflect.apply(listeners[i], this, args);
  }
  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  return this._addListener(type, listener, false);
};

EventEmitter.prototype.on = function(type, listener) {
  return this._addListener(type, listener, false);
};

EventEmitter.prototype.prependListener = function(type, listener) {
  return this._addListener(type, listener, true);
};

EventEmitter.prototype.once = function(type, listener) {
  if (typeof listener !== 'function') throw new TypeError('The "listener" argument must be of type Function.');
  let fired = false;
  const onceWrapper = (...args) => {
    this.removeListener(type, onceWrapper);
    if (!fired) {
      fired = true;
      Reflect.apply(listener, this, args);
    }
  };
  onceWrapper.listener = listener;
  return this.on(type, onceWrapper);
};

EventEmitter.prototype.prependOnceListener = function(type, listener) {
  if (typeof listener !== 'function') throw new TypeError('The "listener" argument must be of type Function.');
  let fired = false;
  const onceWrapper = (...args) => {
    this.removeListener(type, onceWrapper);
    if (!fired) {
      fired = true;
      Reflect.apply(listener, this, args);
    }
  };
  onceWrapper.listener = listener;
  return this.prependListener(type, onceWrapper);
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if (typeof listener !== 'function') throw new TypeError('The "listener" argument must be of type Function.');
  if (!this._events) return this;
  const list = this._events[type];
  if (list === undefined) return this;

  if (list === listener || list.listener === listener) {
    delete this._events[type];
    if (this._events.removeListener) {
      this.emit('removeListener', type, listener);
    }
  } else if (Array.isArray(list)) {
    let position = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === listener || list[i].listener === listener) {
        position = i;
        break;
      }
    }
    if (position < 0) return this;
    list.splice(position, 1);
    if (list.length === 1) this._events[type] = list[0];
    if (this._events.removeListener) {
      this.emit('removeListener', type, listener);
    }
  }
  return this;
};

EventEmitter.prototype.off = function(type, listener) {
  return this.removeListener(type, listener);
};

EventEmitter.prototype.removeAllListeners = function(type) {
  if (!this._events) {
    this._events = Object.create(null);
    return this;
  }
  if (type === undefined) {
    this._events = Object.create(null);
    return this;
  }
  delete this._events[type];
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) return [];
  const list = this._events[type];
  if (!list) return [];
  return Array.isArray(list) ? list.map(l => l.listener || l) : [list.listener || list];
};

EventEmitter.prototype.rawListeners = function(type) {
  if (!this._events) return [];
  const list = this._events[type];
  if (!list) return [];
  return Array.isArray(list) ? list.slice() : [list];
};

EventEmitter.prototype.listenerCount = function(type) {
  if (!this._events) return 0;
  const list = this._events[type];
  if (!list) return 0;
  return Array.isArray(list) ? list.length : 1;
};

EventEmitter.prototype.eventNames = function() {
  if (!this._events) return [];
  return Object.keys(this._events);
};

EventEmitter.prototype._addListener = function(type, listener, prepend) {
  if (typeof listener !== 'function') throw new TypeError('The "listener" argument must be of type Function.');
  if (!this._events) {
    this._events = Object.create(null);
  }
  if (this._events[type] === undefined) {
    this._events[type] = listener;
  } else if (typeof this._events[type] === 'function') {
    this._events[type] = prepend ? [listener, this._events[type]] : [this._events[type], listener];
  } else {
    if (prepend) {
      this._events[type].unshift(listener);
    } else {
      this._events[type].push(listener);
    }
  }
  return this;
};

export default EventEmitter;
`;

export const IN_MEMORY_UTIL_CODE = `
const customPromisifySymbol = Symbol.for('nodejs.util.promisify.custom');

export function promisify(fn) {
  if (typeof fn !== 'function') throw new TypeError('The "original" argument must be of type Function.');
  if (fn[customPromisifySymbol]) {
    return fn[customPromisifySymbol];
  }
  function fnPromisified(...args) {
    return new Promise((resolve, reject) => {
      try {
        fn.call(this, ...args, (err, ...values) => {
          if (err) return reject(err);
          if (values.length <= 1) return resolve(values[0]);
          return resolve(values);
        });
      } catch (err) {
        reject(err);
      }
    });
  }
  Object.setPrototypeOf(fnPromisified, Object.getPrototypeOf(fn));
  Object.defineProperties(fnPromisified, Object.getOwnPropertyDescriptors(fn));
  return fnPromisified;
}
promisify.custom = customPromisifySymbol;

export function callbackify(fn) {
  if (typeof fn !== 'function') throw new TypeError('The "original" argument must be of type Function.');
  return function (...args) {
    const cb = args.pop();
    if (typeof cb !== 'function') throw new TypeError('The last argument must be of type Function.');
    fn.apply(this, args).then(
      ret => queueMicrotask(() => cb(null, ret)),
      err => queueMicrotask(() => cb(err))
    );
  };
}

export function inherits(ctor, superCtor) {
  if (ctor === undefined || ctor === null) throw new TypeError('ctor must not be null or undefined');
  if (superCtor === undefined || superCtor === null) throw new TypeError('superCtor must not be null or undefined');
  if (superCtor.prototype === undefined) throw new TypeError('superCtor.prototype must not be undefined');
  Object.defineProperty(ctor, 'super_', {
    value: superCtor,
    writable: true,
    configurable: true
  });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

export function format(formatStr, ...args) {
  if (typeof formatStr !== 'string') {
    return [formatStr, ...args].map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  }
  let argIndex = 0;
  let result = formatStr.replace(/%[sdjifoO%]/g, match => {
    if (match === '%%') return '%';
    if (argIndex >= args.length) return match;
    const arg = args[argIndex++];
    if (match === '%s') return String(arg);
    if (match === '%d' || match === '%i') return parseInt(arg, 10);
    if (match === '%f') return parseFloat(arg);
    if (match === '%j' || match === '%o' || match === '%O') {
      try { return JSON.stringify(arg); } catch { return '[Circular]'; }
    }
    return match;
  });
  while (argIndex < args.length) {
    result += ' ' + (typeof args[argIndex] === 'object' ? JSON.stringify(args[argIndex]) : String(args[argIndex]));
    argIndex++;
  }
  return result;
}

export function inspect(obj, options) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function deprecate(fn, msg, code) {
  let warned = false;
  return function (...args) {
    if (!warned) {
      warned = true;
      console.warn('[DEP] ' + (code ? '[' + code + '] ' : '') + msg);
    }
    return fn.apply(this, args);
  };
}

export const types = {
  isPromise: v => v instanceof Promise || (v !== null && typeof v === 'object' && typeof v.then === 'function'),
  isDate: v => Object.prototype.toString.call(v) === '[object Date]',
  isRegExp: v => Object.prototype.toString.call(v) === '[object RegExp]',
  isNativeError: v => v instanceof Error,
  isMap: v => typeof Map !== 'undefined' && v instanceof Map,
  isSet: v => typeof Set !== 'undefined' && v instanceof Set,
  isUint8Array: v => v instanceof Uint8Array,
  isArrayBuffer: v => v instanceof ArrayBuffer,
};

export function formatWithOptions(inspectOptions, formatStr, ...args) {
  return format(formatStr, ...args);
}

export function parseEnv(content) {
  return {};
}

export function stripVTControlCharacters(str) {
  return typeof str === 'string' ? str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '') : '';
}

export function styleText(format, text) {
  return text;
}

export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;

const _util = {
  promisify,
  callbackify,
  inherits,
  format,
  formatWithOptions,
  parseEnv,
  stripVTControlCharacters,
  styleText,
  inspect,
  deprecate,
  types,
  TextEncoder,
  TextDecoder,
};

export default _util;
`;

export const IN_MEMORY_UTIL_TYPES_CODE = `
export const isPromise = v => v instanceof Promise || (v !== null && typeof v === 'object' && typeof v.then === 'function');
export const isDate = v => Object.prototype.toString.call(v) === '[object Date]';
export const isRegExp = v => Object.prototype.toString.call(v) === '[object RegExp]';
export const isNativeError = v => v instanceof Error;
export const isMap = v => typeof Map !== 'undefined' && v instanceof Map;
export const isSet = v => typeof Set !== 'undefined' && v instanceof Set;
export const isUint8Array = v => v instanceof Uint8Array;
export const isArrayBuffer = v => v instanceof ArrayBuffer;

const types = {
  isPromise,
  isDate,
  isRegExp,
  isNativeError,
  isMap,
  isSet,
  isUint8Array,
  isArrayBuffer,
};
export default types;
`;

export const IN_MEMORY_BUFFER_CODE = `
import { Buffer as LumianaBuffer } from 'virtual:lumiana';

export const Buffer = LumianaBuffer;
export const SlowBuffer = LumianaBuffer;
export const kMaxLength = 2147483647;
export const constants = {
  MAX_LENGTH: 2147483647,
  MAX_STRING_LENGTH: 536870888,
};
export const isAscii = () => true;
export const isUtf8 = () => true;

export const byteLength = LumianaBuffer.byteLength.bind(LumianaBuffer);
export const isBuffer = LumianaBuffer.isBuffer.bind(LumianaBuffer);
export const isEncoding = LumianaBuffer.isEncoding.bind(LumianaBuffer);
export const concat = LumianaBuffer.concat.bind(LumianaBuffer);
export const compare = LumianaBuffer.compare.bind(LumianaBuffer);
export const alloc = LumianaBuffer.alloc.bind(LumianaBuffer);
export const allocUnsafe = LumianaBuffer.allocUnsafe.bind(LumianaBuffer);
export const allocUnsafeSlow = LumianaBuffer.allocUnsafeSlow.bind(LumianaBuffer);
export const from = LumianaBuffer.from.bind(LumianaBuffer);

LumianaBuffer.Buffer = LumianaBuffer;
LumianaBuffer.SlowBuffer = LumianaBuffer;
LumianaBuffer.kMaxLength = kMaxLength;
LumianaBuffer.constants = constants;
LumianaBuffer.byteLength = byteLength;
LumianaBuffer.isBuffer = isBuffer;
LumianaBuffer.isEncoding = isEncoding;
LumianaBuffer.concat = concat;
LumianaBuffer.compare = compare;
LumianaBuffer.alloc = alloc;
LumianaBuffer.allocUnsafe = allocUnsafe;
LumianaBuffer.allocUnsafeSlow = allocUnsafeSlow;
LumianaBuffer.from = from;

export default LumianaBuffer;
`;

export const IN_MEMORY_PROCESS_CODE = `
const _proc = typeof window !== 'undefined' && window.process ? window.process : (typeof globalThis !== 'undefined' && globalThis.process ? globalThis.process : {});

export const env = _proc.env;
export const argv = _proc.argv;
export const cwd = _proc.cwd ? _proc.cwd.bind(_proc) : () => '/';
export const nextTick = _proc.nextTick ? _proc.nextTick.bind(_proc) : (fn, ...args) => queueMicrotask(() => fn(...args));
export const version = _proc.version || 'v22.0.0';
export const versions = _proc.versions || { node: '22.0.0' };
export const platform = _proc.platform || 'darwin';
export const arch = _proc.arch || 'x64';
export const pid = _proc.pid || 12345;
export const stdout = _proc.stdout;
export const stderr = _proc.stderr;
export const stdin = _proc.stdin;
export const exit = _proc.exit ? _proc.exit.bind(_proc) : () => {};
export const hrtime = _proc.hrtime ? _proc.hrtime.bind(_proc) : () => [0, 0];
export const uptime = _proc.uptime ? _proc.uptime.bind(_proc) : () => 0;
export const memoryUsage = _proc.memoryUsage ? _proc.memoryUsage.bind(_proc) : () => ({});

export default _proc;
`;

export const IN_MEMORY_ASSERT_CODE = `
export function assert(value, message) {
  if (!value) {
    const err = new Error(message || 'Assertion failed');
    err.name = 'AssertionError';
    throw err;
  }
}

assert.ok = assert;
assert.strictEqual = function strictEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    const err = new Error(message || 'Expected ' + JSON.stringify(actual) + ' to strictly equal ' + JSON.stringify(expected));
    err.name = 'AssertionError';
    throw err;
  }
};
assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (Object.is(actual, expected)) {
    const err = new Error(message || 'Expected ' + JSON.stringify(actual) + ' not to strictly equal ' + JSON.stringify(expected));
    err.name = 'AssertionError';
    throw err;
  }
};
assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const err = new Error(message || 'Expected ' + JSON.stringify(actual) + ' to deeply equal ' + JSON.stringify(expected));
    err.name = 'AssertionError';
    throw err;
  }
};
assert.throws = function throws(block, error, message) {
  let threw = false;
  try {
    block();
  } catch (e) {
    threw = true;
  }
  if (!threw) {
    const err = new Error(message || 'Missing expected exception');
    err.name = 'AssertionError';
    throw err;
  }
};
export const ok = assert;
export const strictEqual = assert.strictEqual;
export const notStrictEqual = assert.notStrictEqual;
export const deepStrictEqual = assert.deepStrictEqual;
export const throws = assert.throws;
export default assert;
`;

export const IN_MEMORY_STRING_DECODER_CODE = `
export class StringDecoder {
  constructor(encoding = 'utf8') {
    this.encoding = encoding;
    this.decoder = new TextDecoder(encoding === 'utf8' ? 'utf-8' : encoding);
  }
  write(buf) {
    return this.decoder.decode(buf, { stream: true });
  }
  end(buf) {
    return buf ? this.decoder.decode(buf) : '';
  }
}
export default { StringDecoder };
`;

export const IN_MEMORY_PERF_HOOKS_CODE = `
const _perf = typeof globalThis !== 'undefined' && globalThis.performance ? globalThis.performance : { now: () => Date.now() };
export const performance = _perf;
export const PerformanceObserver = typeof globalThis !== 'undefined' && globalThis.PerformanceObserver ? globalThis.PerformanceObserver : class {};
export const PerformanceEntry = typeof globalThis !== 'undefined' && globalThis.PerformanceEntry ? globalThis.PerformanceEntry : class {};
export default { performance: _perf, PerformanceObserver, PerformanceEntry };
`;

