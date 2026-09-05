const scope = globalThis;

export const setTimeout = scope.setTimeout.bind(scope);
export const clearTimeout = scope.clearTimeout.bind(scope);
export const setInterval = scope.setInterval.bind(scope);
export const clearInterval = scope.clearInterval.bind(scope);

export function setImmediate(
  callback: (...args: any[]) => void,
  ...args: any[]
): ReturnType<typeof globalThis.setTimeout> {
  return scope.setTimeout(callback, 0, ...args);
}

export function clearImmediate(handle: ReturnType<typeof globalThis.setTimeout>): void {
  scope.clearTimeout(handle);
}

export default {
  clearImmediate,
  clearInterval,
  clearTimeout,
  setImmediate,
  setInterval,
  setTimeout,
};
