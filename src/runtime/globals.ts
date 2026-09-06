/** Supply Node globals that the execution realm does not already provide. */
export function installGlobals<T extends object>(scope: T, bindings: Record<string, any>): T {
  for (const [name, value] of Object.entries(bindings)) {
    if (name in scope) continue;
    Object.defineProperty(scope, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  }
  return scope;
}
