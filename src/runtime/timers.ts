const scope = globalThis;
const nativeSetTimeout = scope.setTimeout.bind(scope);
const nativeClearTimeout = scope.clearTimeout.bind(scope);
const nativeSetInterval = scope.setInterval.bind(scope);
const nativeClearInterval = scope.clearInterval.bind(scope);

type NativeTimer = ReturnType<typeof globalThis.setTimeout>;

abstract class NodeHandle {
  protected native?: NativeTimer;
  private referenced = true;

  abstract cancel(): void;

  ref(): this {
    this.referenced = true;
    return this;
  }

  unref(): this {
    this.referenced = false;
    return this;
  }

  hasRef(): boolean {
    return this.referenced;
  }

  [Symbol.dispose](): void {
    this.cancel();
  }
}

/** A local scheduler with the observable handle contract exposed by Node timers. */
export class TimerHandle extends NodeHandle {
  constructor(
    private interval: boolean,
    private callback: (...args: any[]) => void,
    private delay: number,
    private args: any[],
  ) {
    super();
    this.schedule();
  }

  private schedule(): void {
    const invoke = () => this.callback(...this.args);
    this.native = this.interval
      ? nativeSetInterval(invoke, this.delay)
      : nativeSetTimeout(invoke, this.delay);
  }

  private cancelNative(): void {
    if (this.native === undefined) return;
    if (this.interval) nativeClearInterval(this.native);
    else nativeClearTimeout(this.native);
    this.native = undefined;
  }

  refresh(): this {
    this.cancelNative();
    this.schedule();
    return this;
  }

  close(): this {
    this.cancel();
    return this;
  }

  [Symbol.toPrimitive](): number {
    return Number(this.native ?? 0);
  }

  cancel(): void {
    this.cancelNative();
  }
}

export class ImmediateHandle extends NodeHandle {
  constructor(callback: (...args: any[]) => void, args: any[]) {
    super();
    this.native = nativeSetTimeout(callback, 0, ...args);
  }

  cancel(): void {
    if (this.native !== undefined) nativeClearTimeout(this.native);
    this.native = undefined;
  }
}

type Timer = NodeHandle | NativeTimer | number | undefined;

const clear = (handle: Timer): void => {
  if (handle instanceof NodeHandle) handle.cancel();
  else {
    nativeClearTimeout(handle as NativeTimer);
    nativeClearInterval(handle as NativeTimer);
  }
};

function assertCallback(callback: unknown): asserts callback is (...args: any[]) => void {
  if (typeof callback !== 'function')
    throw new TypeError(
      `The "callback" argument must be of type function. Received ${typeof callback}`,
    );
}

export function setTimeout(
  callback: (...args: any[]) => void,
  delay = 1,
  ...args: any[]
): TimerHandle {
  assertCallback(callback);
  return new TimerHandle(false, callback, delay, args);
}

export function clearTimeout(handle: Timer): void {
  clear(handle);
}

export function setInterval(
  callback: (...args: any[]) => void,
  delay = 1,
  ...args: any[]
): TimerHandle {
  assertCallback(callback);
  return new TimerHandle(true, callback, delay, args);
}

export function clearInterval(handle: Timer): void {
  clear(handle);
}

export function setImmediate(callback: (...args: any[]) => void, ...args: any[]): ImmediateHandle {
  assertCallback(callback);
  return new ImmediateHandle(callback, args);
}

export function clearImmediate(handle: Timer): void {
  clear(handle);
}

export default {
  clearImmediate,
  clearInterval,
  clearTimeout,
  setImmediate,
  setInterval,
  setTimeout,
};
