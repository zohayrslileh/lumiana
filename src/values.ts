import { Buffer } from 'buffer';
import {
  failure,
  restoreError,
  type Atom,
  type Failure,
  type Graph,
  type ValueNode,
} from './protocol.js';
const symbols = new Map<symbol, string>();
for (const name of Object.getOwnPropertyNames(Symbol)) {
  const value = (Symbol as any)[name];
  if (typeof value === 'symbol') symbols.set(value, name);
}
const binary: Record<string, (b: Uint8Array<ArrayBuffer>) => unknown> = {
  Buffer: (b) => Buffer.from(b),
  ArrayBuffer: (b) => b.buffer,
  DataView: (b) => new DataView(b.buffer),
  Uint8Array: (b) => b,
  Int8Array: (b) => new Int8Array(b.buffer),
  Uint8ClampedArray: (b) => new Uint8ClampedArray(b.buffer),
  Int16Array: (b) => new Int16Array(b.buffer),
  Uint16Array: (b) => new Uint16Array(b.buffer),
  Int32Array: (b) => new Int32Array(b.buffer),
  Uint32Array: (b) => new Uint32Array(b.buffer),
  Float32Array: (b) => new Float32Array(b.buffer),
  Float64Array: (b) => new Float64Array(b.buffer),
  BigInt64Array: (b) => new BigInt64Array(b.buffer),
  BigUint64Array: (b) => new BigUint64Array(b.buffer),
};
/** Boundary values are copied. JavaScript identity never leaves its local runtime. */
export function encodeValue(value: unknown): Graph {
  const nodes: ValueNode[] = [],
    seen = new Map<unknown, number>();
  function visit(value: any): Atom {
    if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return value;
    const previous = seen.get(value);
    if (previous !== undefined) return { index: previous };
    const index = nodes.length;
    seen.set(value, index);
    nodes.push({ kind: 'undefined' });
    let node: ValueNode;
    if (value === undefined) node = { kind: 'undefined' };
    else if (typeof value === 'bigint') node = { kind: 'bigint', value: String(value) };
    else if (
      typeof value === 'symbol' &&
      (symbols.has(value) || Symbol.keyFor(value) !== undefined)
    )
      node = {
        kind: 'symbol',
        name: symbols.get(value) ?? Symbol.keyFor(value)!,
        global: !symbols.has(value),
      };
    else if (
      Object.prototype.toString.call(value) === '[object ArrayBuffer]' ||
      ArrayBuffer.isView(value)
    ) {
      const bytes =
        Object.prototype.toString.call(value) === '[object ArrayBuffer]'
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const name = Buffer.isBuffer(value) ? 'Buffer' : value.constructor.name;
      if (!Object.hasOwn(binary, name)) throw new TypeError(`Unsupported binary type ${name}`);
      node = { kind: 'binary', name, bytes };
    } else if (Array.isArray(value)) node = { kind: 'array', items: value.map(visit) };
    else if (Object.prototype.toString.call(value) === '[object Date]')
      node = { kind: 'date', value: value.getTime() };
    else if (Object.prototype.toString.call(value) === '[object RegExp]')
      node = { kind: 'regexp', source: value.source, flags: value.flags };
    else if (
      typeof value === 'object' &&
      (Object.getPrototypeOf(value) === null ||
        Object.getPrototypeOf(value) === Object.prototype ||
        (Object.getPrototypeOf(Object.getPrototypeOf(value)) === null &&
          Object.getPrototypeOf(value).constructor?.name === 'Object')) &&
      Object.prototype.toString.call(value) === '[object Object]' &&
      Reflect.ownKeys(value).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        return descriptor.enumerable && 'value' in descriptor;
      })
    )
      node = {
        kind: 'object',
        nullPrototype: Object.getPrototypeOf(value) === null,
        entries: Reflect.ownKeys(value).map((k) => [visit(k), visit(value[k])]),
      };
    else
      throw new TypeError(
        `Cannot send ${typeof value === 'function' ? 'a function' : Object.prototype.toString.call(value)} across the Lumiana boundary`,
      );
    nodes[index] = node;
    return { index };
  }
  return { root: visit(value), nodes };
}
export function decodeValue(graph: Graph): any {
  const values: any[] = graph.nodes.map((node) => {
    switch (node.kind) {
      case 'undefined':
        return undefined;
      case 'bigint':
        return BigInt(node.value);
      case 'symbol':
        return node.global ? Symbol.for(node.name) : (Symbol as any)[node.name];
      case 'object':
        return Object.create(node.nullPrototype ? null : Object.prototype);
      case 'array':
        return [];
      case 'date':
        return new Date(node.value);
      case 'regexp':
        return new RegExp(node.source, node.flags);
      case 'binary': {
        const construct = Object.hasOwn(binary, node.name) ? binary[node.name] : undefined;
        if (!construct) throw new TypeError(`Unknown binary type ${node.name}`);
        return construct(new Uint8Array(node.bytes));
      }
    }
  });
  const read = (atom: Atom): any =>
    atom !== null && typeof atom === 'object' ? values[atom.index] : atom;
  graph.nodes.forEach((node, i) => {
    if (node.kind === 'array') {
      for (const item of node.items) values[i].push(read(item));
    } else if (node.kind === 'object')
      for (const [key, value] of node.entries)
        Object.defineProperty(values[i], read(key), {
          value: read(value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
  });
  return read(graph.root);
}

export function encodeException(error: unknown): Failure {
  if (
    error instanceof Error ||
    (typeof error === 'object' &&
      error !== null &&
      Object.prototype.toString.call(error) === '[object Error]')
  )
    return failure(error);
  try {
    return { ...failure(error), thrown: encodeValue(error) };
  } catch {
    return failure(error);
  }
}

export const decodeException = (info: Failure): unknown =>
  info.thrown ? decodeValue(info.thrown) : restoreError(info);
