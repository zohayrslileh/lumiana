const NativeVariable = (globalThis as any).AsyncContext?.Variable;

export class AsyncLocalStorage<T = any> {
  private variable = NativeVariable ? new NativeVariable() : undefined;
  private current: T | undefined;

  disable(): void {
    this.current = undefined;
  }

  getStore(): T | undefined {
    return this.variable ? this.variable.get() : this.current;
  }

  enterWith(store: T): void {
    if (this.variable?.enterWith) this.variable.enterWith(store);
    else this.current = store;
  }

  run<R, A extends any[]>(store: T, callback: (...args: A) => R, ...args: A): R {
    if (this.variable) return this.variable.run(store, () => callback(...args));
    const previous = this.current;
    this.current = store;
    try {
      return callback(...args);
    } finally {
      this.current = previous;
    }
  }

  exit<R, A extends any[]>(callback: (...args: A) => R, ...args: A): R {
    return this.run(undefined as T, callback, ...args);
  }

  static bind<F extends (...args: any[]) => any>(fn: F): F {
    return fn;
  }

  static snapshot(): <R, A extends any[]>(fn: (...args: A) => R, ...args: A) => R {
    return (fn, ...args) => fn(...args);
  }
}

export class AsyncResource {
  constructor(
    readonly type: string,
    _options?: any,
  ) {}

  runInAsyncScope<R, A extends any[]>(fn: (...args: A) => R, receiver: any, ...args: A): R {
    return Reflect.apply(fn, receiver, args);
  }

  emitDestroy(): this {
    return this;
  }

  asyncId(): number {
    return 0;
  }

  triggerAsyncId(): number {
    return 0;
  }

  static bind<F extends (...args: any[]) => any>(fn: F): F {
    return fn;
  }
}

export const executionAsyncId = () => 0;
export const triggerAsyncId = () => 0;
export const executionAsyncResource = () => globalThis;
export const createHook = () => ({
  enable() {
    return this;
  },
  disable() {
    return this;
  },
});

export default {
  AsyncLocalStorage,
  AsyncResource,
  createHook,
  executionAsyncId,
  executionAsyncResource,
  triggerAsyncId,
};
