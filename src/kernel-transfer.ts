const array = Symbol.for('lumiana.kernel.array');

/** Encode only an operation's positional list; its argument values keep normal ownership. */
export function packKernelList(values: any[]): Record<PropertyKey, any> {
  const record = Object.create(null);
  record[array] = Object.fromEntries(values.map((value, index) => [index, value]));
  return record;
}

/** Copy operational arrays while arbitrary JavaScript arrays retain reference identity. */
export function packKernel(value: any, seen = new Map<any, any>()): any {
  if (
    !value ||
    typeof value !== 'object' ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer
  )
    return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const record = packKernelList(value);
    seen.set(value, record);
    for (const key of Object.keys(record[array]))
      record[array][key] = packKernel(record[array][key], seen);
    return record;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const record = Object.create(prototype);
  seen.set(value, record);
  for (const key of Reflect.ownKeys(value))
    if (Object.getOwnPropertyDescriptor(value, key)?.enumerable)
      record[key] = packKernel(value[key], seen);
  return record;
}

export function unpackKernel(value: any, seen = new Map<any, any>()): any {
  if (
    !value ||
    typeof value !== 'object' ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer
  )
    return value;
  if (seen.has(value)) return seen.get(value);
  if (array in value) {
    const result: any[] = [];
    seen.set(value, result);
    for (const item of Object.values(value[array])) result.push(unpackKernel(item, seen));
    return result;
  }
  const record = Object.create(Object.getPrototypeOf(value));
  seen.set(value, record);
  for (const key of Reflect.ownKeys(value))
    if (Object.getOwnPropertyDescriptor(value, key)?.enumerable)
      record[key] = unpackKernel(value[key], seen);
  return record;
}
