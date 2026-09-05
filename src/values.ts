import { Buffer } from 'buffer';
import type { Atom, Graph, Reference, ValueNode } from './protocol.js';
export interface ValueReferences {
  export(value: object | symbol): Reference;
  remote(value: object | symbol): number | undefined;
  import(ref: Reference): any;
  original(id: number): any;
}
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
/** Plain records are snapshots. Native values retain their owner and identity. */
export function encodeValue(value: unknown, refs: ValueReferences, reference = false): Graph {
  const nodes: ValueNode[] = [],
    seen = new Map<unknown, number>();
  function visit(value: any, force = false): Atom {
    if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return value;
    const previous = seen.get(value);
    if (previous !== undefined) return { index: previous };
    const index = nodes.length;
    seen.set(value, index);
    nodes.push({ kind: 'undefined' });
    let node: ValueNode;
    const remote =
      value !== undefined && typeof value !== 'bigint' ? refs.remote(value) : undefined;
    if (remote !== undefined) node = { kind: 'return', id: remote };
    else if (value === undefined) node = { kind: 'undefined' };
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
    else if (!force && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) {
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const name = Buffer.isBuffer(value) ? 'Buffer' : value.constructor.name;
      node = Object.hasOwn(binary, name)
        ? { kind: 'binary', name, bytes }
        : { kind: 'reference', ref: refs.export(value) };
    } else if (
      !force &&
      typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.prototype.toString.call(value) === '[object Object]'
    )
      node = {
        kind: 'object',
        nullPrototype: Object.getPrototypeOf(value) === null,
        entries: Reflect.ownKeys(value)
          .filter((k) => Object.getOwnPropertyDescriptor(value, k)?.enumerable)
          .map((k) => [visit(k), visit(value[k])]),
      };
    else node = { kind: 'reference', ref: refs.export(value) };
    nodes[index] = node;
    return { index };
  }
  return { root: visit(value, reference), nodes };
}
export function decodeValue(graph: Graph, refs: ValueReferences): any {
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
      case 'binary': {
        const construct = Object.hasOwn(binary, node.name) ? binary[node.name] : undefined;
        if (!construct) throw new TypeError(`Unknown binary type ${node.name}`);
        return construct(new Uint8Array(node.bytes));
      }
      case 'reference':
        return refs.import(node.ref);
      case 'return':
        return refs.original(node.id);
    }
  });
  const read = (atom: Atom): any =>
    atom !== null && typeof atom === 'object' ? values[atom.index] : atom;
  graph.nodes.forEach((node, i) => {
    if (node.kind === 'object')
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
