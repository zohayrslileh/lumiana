const NativeVariable = (globalThis as any).AsyncContext?.Variable;
const activeStores = new Map<AsyncLocalStorage<any>, any>();
let nextAsyncId = 1;

export class AsyncLocalStorage<T = any> {
  private variable = NativeVariable ? new NativeVariable() : undefined;
  private current: T | undefined;

  disable(): void {
    this.current = undefined;
    activeStores.delete(this);
  }

  getStore(): T | undefined {
    return this.variable ? this.variable.get() : this.current;
  }

  enterWith(store: T): void {
    if (this.variable?.enterWith) this.variable.enterWith(store);
    else this.current = store;
    activeStores.set(this, store);
  }

  run<R, A extends any[]>(store: T, callback: (...args: A) => R, ...args: A): R {
    const previous = this.current;
    const wasActive = activeStores.has(this);
    const previousActive = activeStores.get(this);
    this.current = store;
    activeStores.set(this, store);
    try {
      return this.variable ? this.variable.run(store, () => callback(...args)) : callback(...args);
    } finally {
      this.current = previous;
      if (wasActive) activeStores.set(this, previousActive);
      else activeStores.delete(this);
    }
  }

  exit<R, A extends any[]>(callback: (...args: A) => R, ...args: A): R {
    return this.run(undefined as T, callback, ...args);
  }

  static bind<F extends (...args: any[]) => any>(fn: F): F {
    return new AsyncResource(fn.name || 'bound-anonymous-fn').bind(fn);
  }

  static snapshot(): <R, A extends any[]>(fn: (...args: A) => R, ...args: A) => R {
    const resource = new AsyncResource('AsyncLocalStorage.snapshot');
    return (fn, ...args) => resource.runInAsyncScope(fn, undefined, ...args);
  }
}

export class AsyncResource {
  private readonly id = nextAsyncId++;
  private readonly trigger = executionAsyncId();
  private readonly stores = new Map(activeStores);

  constructor(
    readonly type: string,
    _options?: any,
  ) {}

  runInAsyncScope<R, A extends any[]>(fn: (...args: A) => R, receiver: any, ...args: A): R {
    const entries = [...this.stores];
    const run = (index: number): R =>
      index === entries.length
        ? Reflect.apply(fn, receiver, args)
        : entries[index][0].run(entries[index][1], () => run(index + 1));
    return run(0);
  }

  emitDestroy(): this {
    return this;
  }

  asyncId(): number {
    return this.id;
  }

  triggerAsyncId(): number {
    return this.trigger;
  }

  bind<F extends (...args: any[]) => any>(fn: F): F {
    if (typeof fn !== 'function') throw new TypeError('fn must be a function');
    const resource = this;
    const bound = function (this: any, ...args: any[]) {
      return resource.runInAsyncScope(fn, this, ...args);
    };
    Object.defineProperties(bound, {
      length: { value: fn.length },
      asyncResource: { value: this },
    });
    return bound as F;
  }

  static bind<F extends (...args: any[]) => any>(fn: F, type?: string, receiver?: any): F {
    const bound = new AsyncResource(type ?? (fn.name || 'bound-anonymous-fn')).bind(fn);
    return (receiver === undefined ? bound : bound.bind(receiver)) as F;
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
