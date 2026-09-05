import { encode, decode } from '@msgpack/msgpack';
export const PREFIX = '/__lumiana/';
export const encodePacket = (value: unknown): Uint8Array => encode(value);
export const decodePacket = (bytes: Uint8Array): any => decode(bytes);
export type Atom = null | boolean | number | string | { index: number };
export interface Reference {
  id: number;
  kind: 'object' | 'array' | 'function' | 'promise' | 'symbol';
  name?: string;
  constructible?: boolean;
}
export type ValueNode =
  | { kind: 'undefined' }
  | { kind: 'bigint'; value: string }
  | { kind: 'symbol'; name: string; global: boolean }
  | { kind: 'object'; entries: [Atom, Atom][]; nullPrototype: boolean }
  | { kind: 'binary'; name: string; bytes: Uint8Array }
  | { kind: 'reference'; ref: Reference }
  | { kind: 'return'; id: number };
export interface Graph {
  root: Atom;
  nodes: ValueNode[];
  /** Reads to resume locally after reaching a value that crosses by copy. */
  path?: string[];
}
export interface Invocation {
  operation: string;
  args: Graph[];
  path?: string[];
}
export type NativeExpression =
  | { kind: 'literal'; value: null | boolean | number | string }
  | { kind: 'global'; name: string }
  | { kind: 'get'; object: NativeExpression; key: string }
  | {
      kind: 'call';
      object: NativeExpression;
      key: string;
      arguments: Record<string, NativeExpression>;
    };
export interface Failure {
  name: string;
  message: string;
  stack?: string;
  properties?: Record<string, unknown>;
  thrown?: Graph;
}
export function failure(error: unknown): Failure {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const properties: Record<string, unknown> = {};
  for (const key of Object.keys(error)) {
    const value = (error as any)[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      properties[key] = value;
  }
  return { name: error.name, message: error.message, stack: error.stack, properties };
}
export function restoreError(info: Failure): Error {
  const constructors: Record<string, new (message: string) => Error> = {
    Error,
    TypeError,
    RangeError,
    ReferenceError,
    SyntaxError,
    URIError,
    EvalError,
  };
  const Constructor = Object.hasOwn(constructors, info.name) ? constructors[info.name]! : Error;
  const error = new Constructor(info.message);
  error.name = info.name;
  if (info.stack) error.stack = info.stack;
  Object.assign(error, info.properties);
  return error;
}

export function restoreException(info: Failure, decode: (value: Graph) => unknown): any {
  return info.thrown ? decode(info.thrown) : restoreError(info);
}
