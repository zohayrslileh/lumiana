const contexts = new WeakSet<object>();

/** Evaluate against the browser global realm without capturing this module's lexical scope. */
export function runInThisContext(code: string, _options?: any): any {
  return (0, eval)(code);
}

export function createContext(context: Record<string, any> = {}): Record<string, any> {
  contexts.add(context);
  return context;
}

export const isContext = (value: unknown) =>
  Boolean(value && typeof value === 'object' && contexts.has(value as object));

export function runInContext(code: string, context: Record<string, any>, _options?: any): any {
  if (!isContext(context)) throw new TypeError('The contextifiedObject must be a vm.Context');
  const names = Object.keys(context);
  const values = names.map((name) => context[name]);
  return Function(...names, `return (${code}\n)`)(...values);
}

export function runInNewContext(
  code: string,
  context: Record<string, any> = {},
  options?: any,
): any {
  return runInContext(code, createContext(context), options);
}

export class Script {
  constructor(
    readonly code: string,
    readonly options?: any,
  ) {}
  runInThisContext(options?: any) {
    return runInThisContext(this.code, options ?? this.options);
  }
  runInContext(context: Record<string, any>, options?: any) {
    return runInContext(this.code, context, options ?? this.options);
  }
  runInNewContext(context?: Record<string, any>, options?: any) {
    return runInNewContext(this.code, context, options ?? this.options);
  }
}

export const compileFunction = (code: string, params: string[] = [], _options?: any) =>
  Function(...params, code);
export const measureMemory = () => Promise.reject(new Error('vm.measureMemory is unavailable'));

export default {
  Script,
  compileFunction,
  createContext,
  isContext,
  measureMemory,
  runInContext,
  runInNewContext,
  runInThisContext,
};
