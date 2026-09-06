import { encode, decode } from '@msgpack/msgpack';
export const PREFIX = '/__lumiana/';
export const encodePacket = (value: unknown): Uint8Array => encode(value);
export const decodePacket = (bytes: Uint8Array): any => decode(bytes);
export type Atom = null | boolean | number | string | { index: number };
export type ValueNode =
  | { kind: 'undefined' }
  | { kind: 'bigint'; value: string }
  | { kind: 'symbol'; name: string; global: boolean }
  | { kind: 'object'; entries: [Atom, Atom][]; nullPrototype: boolean }
  | { kind: 'array'; items: Atom[] }
  | { kind: 'date'; value: number }
  | { kind: 'regexp'; source: string; flags: string }
  | { kind: 'binary'; name: string; bytes: Uint8Array };
export interface Graph {
  root: Atom;
  nodes: ValueNode[];
}
export interface Invocation {
  operation: string;
  args: Graph[];
}
export interface Failure {
  name: string;
  message: string;
  stack?: string;
  properties?: Record<string, unknown>;
  thrown?: Graph;
}
export function failure(error: unknown): Failure {
  const errorLike =
    error instanceof Error ||
    (typeof error === 'object' &&
      error !== null &&
      Object.prototype.toString.call(error) === '[object Error]');
  if (!errorLike) return { name: 'Error', message: String(error) };
  const value = error as Error;
  const properties: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const property = (value as any)[key];
    if (property === null || ['string', 'number', 'boolean'].includes(typeof property))
      properties[key] = property;
  }
  return { name: value.name, message: value.message, stack: value.stack, properties };
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
