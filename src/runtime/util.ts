import browserUtil from 'util/util.js';

type FunctionValue = (...args: any[]) => any;

const customPromisify = Symbol.for('nodejs.util.promisify.custom');

export const promisify = Object.assign(
  function promisify<T extends FunctionValue>(original: T): FunctionValue {
    if (typeof original !== 'function')
      throw new TypeError('The "original" argument must be of type Function');
    const custom = (original as any)[customPromisify];
    if (custom !== undefined) {
      if (typeof custom !== 'function')
        throw new TypeError('The "util.promisify.custom" property must be a function');
      Object.defineProperty(custom, customPromisify, {
        configurable: true,
        value: custom,
      });
      return custom;
    }

    const wrapped = function (this: any, ...args: any[]) {
      return new Promise((resolve, reject) => {
        args.push((error: any, value: any) => (error ? reject(error) : resolve(value)));
        Reflect.apply(original, this, args);
      });
    };
    Object.setPrototypeOf(wrapped, Object.getPrototypeOf(original));
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    Object.defineProperty(wrapped, customPromisify, {
      configurable: true,
      value: wrapped,
    });
    return wrapped;
  },
  { custom: customPromisify },
);

export const _extend = browserUtil._extend;
export const callbackify = browserUtil.callbackify;
export const debuglog = browserUtil.debuglog;
export const deprecate = browserUtil.deprecate;
export const format = browserUtil.format;
/** Establish Node's constructor/prototype inheritance without a dependency cycle through `util`. */
export function inherits(constructor: Function, superConstructor: Function): void {
  if (typeof constructor !== 'function')
    throw new TypeError('The "constructor" argument must be of type function');
  if (typeof superConstructor !== 'function')
    throw new TypeError('The "superConstructor" argument must be of type function');
  if (!superConstructor.prototype)
    throw new TypeError('The "superConstructor.prototype" property must be an object');
  Object.defineProperty(constructor, 'super_', {
    configurable: true,
    writable: true,
    value: superConstructor,
  });
  Object.setPrototypeOf(constructor.prototype, superConstructor.prototype);
}
export const inspect = browserUtil.inspect;
export const isArray = browserUtil.isArray;
export const isBoolean = browserUtil.isBoolean;
export const isBuffer = browserUtil.isBuffer;
export const isDate = browserUtil.isDate;
export const isError = browserUtil.isError;
export const isFunction = browserUtil.isFunction;
export const isNull = browserUtil.isNull;
export const isNullOrUndefined = browserUtil.isNullOrUndefined;
export const isNumber = browserUtil.isNumber;
export const isObject = browserUtil.isObject;
export const isPrimitive = browserUtil.isPrimitive;
export const isRegExp = browserUtil.isRegExp;
export const isString = browserUtil.isString;
export const isSymbol = browserUtil.isSymbol;
export const isUndefined = browserUtil.isUndefined;
export const log = browserUtil.log;
export const types = browserUtil.types;
export const TextDecoder = globalThis.TextDecoder;
export const TextEncoder = globalThis.TextEncoder;

export const formatWithOptions = (_options: any, ...args: any[]) => format(...args);
export const stripVTControlCharacters = (value: string) =>
  String(value).replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    '',
  );
export const toUSVString = (value: any) =>
  String(value).replace(/[\uD800-\uDFFF]/g, (unit, offset, string) => {
    const code = unit.charCodeAt(0);
    if (
      code <= 0xdbff &&
      offset + 1 < string.length &&
      string.charCodeAt(offset + 1) >= 0xdc00 &&
      string.charCodeAt(offset + 1) <= 0xdfff
    )
      return unit;
    if (
      code >= 0xdc00 &&
      offset > 0 &&
      string.charCodeAt(offset - 1) >= 0xd800 &&
      string.charCodeAt(offset - 1) <= 0xdbff
    )
      return unit;
    return '\uFFFD';
  });

const runtime = Object.assign({}, browserUtil, {
  TextDecoder,
  TextEncoder,
  formatWithOptions,
  inherits,
  promisify,
  stripVTControlCharacters,
  toUSVString,
});

export default runtime;
