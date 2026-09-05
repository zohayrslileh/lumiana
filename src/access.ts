type Reader = (path: string[]) => any;
// Optimized dependencies can contain separate copies of this small runtime.
// Proxy ownership is shared within a context, independently of module bundling.
const key = Symbol.for('lumiana.referenceReaders');
const readKey = Symbol.for('lumiana.readPath');
const scope = globalThis as any;
const readers: WeakMap<object, Reader> = (scope[key] ??= new WeakMap());

/** @internal Register the read contract for a reference owned by another endpoint. */
export function registerReader(reference: object, read: Reader): void {
  readers.set(reference, read);
}

/** @internal Read locally until reaching a reference with a remote owner. */
export const readPath: (value: any, ...path: string[]) => any = (scope[readKey] ??= function (
  value: any,
  ...path: string[]
): any {
  for (let i = 0; i < path.length; i++) {
    const read = readers.get(value);
    if (read) return read(path.slice(i));
    value = value[path[i]!];
  }
  return value;
});
