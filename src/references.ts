import type { Graph, Invocation, Reference } from './protocol.js';
import { decodeValue, encodeValue, type ValueReferences } from './values.js';
export interface ReferenceTransport {
  sync(invocation: Invocation): Graph;
  async(invocation: Invocation): Promise<Graph>;
  special?(operation: string, args: any[]): any;
}
/** Both endpoints implement the same ownership and reflection contract. */
export class References implements ValueReferences {
  private sequence = 0;
  private originals = new Map<number, any>();
  private exported = new Map<any, Reference>();
  private imported = new Map<number, any>();
  private remotes = new Map<any, number>();
  private active = true;
  constructor(private transport: ReferenceTransport) {}
  assert(): void {
    if (!this.active) throw new Error('Lumiana is disconnected');
  }
  close(): void {
    this.active = false;
    this.originals.clear();
    this.exported.clear();
    this.imported.clear();
    this.remotes.clear();
  }
  export(value: any): Reference {
    const previous = this.exported.get(value);
    if (previous) return previous;
    const ref: Reference = {
      id: ++this.sequence,
      kind:
        typeof value === 'symbol'
          ? 'symbol'
          : typeof value === 'function'
            ? 'function'
            : Array.isArray(value)
              ? 'array'
              : value instanceof Promise
                ? 'promise'
                : 'object',
    };
    if (typeof value === 'symbol') ref.name = value.description;
    if (typeof value === 'function') {
      try {
        Reflect.construct(new Proxy(value, { construct: () => ({}) }), []);
        ref.constructible = true;
      } catch {
        ref.constructible = false;
      }
    }
    this.exported.set(value, ref);
    this.originals.set(ref.id, value);
    // Rejection ownership transfers with the promise. Observe it immediately so
    // transport latency cannot produce a premature native unhandled rejection.
    if (ref.kind === 'promise') void Promise.prototype.then.call(value, undefined, () => {});
    return ref;
  }
  remote(value: any): number | undefined {
    return this.remotes.get(value);
  }
  original(id: number): any {
    this.assert();
    if (!this.originals.has(id)) throw new ReferenceError(`Unknown native reference ${id}`);
    return this.originals.get(id);
  }
  encode(value: any, force = false): Graph {
    return encodeValue(value, this, force);
  }
  decode(value: Graph): any {
    return decodeValue(value, this);
  }
  invoke(operation: string, ...args: any[]): any {
    this.assert();
    return this.decode(this.transport.sync({ operation, args: args.map((v) => this.encode(v)) }));
  }
  async invokeAsync(operation: string, ...args: any[]): Promise<any> {
    this.assert();
    return this.decode(
      await this.transport.async({ operation, args: args.map((v) => this.encode(v)) }),
    );
  }
  execute(input: Invocation): Graph {
    this.assert();
    const [value, key, ...rest] = input.args.map((v) => this.decode(v));
    let result: any;
    switch (input.operation) {
      case 'get':
        result = Reflect.get(value, key, rest[0] ?? value);
        break;
      case 'set':
        result = Reflect.set(value, key, rest[0], rest[1] ?? value);
        break;
      case 'has':
        result = Reflect.has(value, key);
        break;
      case 'delete':
        result = Reflect.deleteProperty(value, key);
        break;
      case 'keys':
        result = Object.fromEntries(Reflect.ownKeys(value).map((key, i) => [i, key]));
        break;
      case 'descriptor':
        result = Reflect.getOwnPropertyDescriptor(value, key);
        break;
      case 'define':
        result = Reflect.defineProperty(value, key, rest[0]);
        break;
      case 'prototype':
        return this.encode(Reflect.getPrototypeOf(value), true);
      case 'setPrototype':
        result = Reflect.setPrototypeOf(value, key);
        break;
      case 'isExtensible':
        result = Reflect.isExtensible(value);
        break;
      case 'preventExtensions':
        result = Reflect.preventExtensions(value);
        break;
      case 'apply':
        result = Reflect.apply(value, key, rest);
        break;
      case 'construct':
        result = Reflect.construct(value, rest, key ?? value);
        break;
      default:
        result = this.transport.special?.(
          input.operation,
          input.args.map((v) => this.decode(v)),
        );
        break;
    }
    return this.encode(result, input.operation === 'module' || input.operation === 'global');
  }
  import(ref: Reference): any {
    this.assert();
    const cached = this.imported.get(ref.id);
    if (cached !== undefined) return cached;
    if (ref.kind === 'symbol') {
      const symbol = Symbol(ref.name);
      this.imported.set(ref.id, symbol);
      this.remotes.set(symbol, ref.id);
      return symbol;
    }
    if (ref.kind === 'promise') {
      let resolve!: (value: any) => void, reject!: (error: any) => void;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      this.imported.set(ref.id, promise);
      this.remotes.set(promise, ref.id);
      this.invokeAsync('await', promise).then(resolve, reject);
      return promise;
    }
    const target: any =
      ref.kind === 'function'
        ? ref.constructible
          ? function () {}.bind(null)
          : () => {}
        : ref.kind === 'array'
          ? []
          : {};
    let proxy: any;
    const request = (operation: string, ...args: any[]) => this.invoke(operation, proxy, ...args);
    const descriptor = (key: PropertyKey): PropertyDescriptor | undefined => {
      const incoming = request('descriptor', key),
        own = Reflect.getOwnPropertyDescriptor(target, key);
      if (own && !own.configurable && 'value' in own && !own.writable && incoming)
        incoming.value = own.value;
      if (incoming && (!incoming.configurable || !Reflect.isExtensible(target)))
        Reflect.defineProperty(target, key, incoming);
      return incoming;
    };
    const mirror = () => {
      const keys = Object.values(request('keys')) as PropertyKey[];
      for (const key of Reflect.ownKeys(target))
        if (!keys.includes(key)) Reflect.deleteProperty(target, key);
      for (const key of keys) {
        const incoming = descriptor(key);
        if (incoming) Reflect.defineProperty(target, key, incoming);
      }
      Reflect.setPrototypeOf(target, request('prototype'));
      Reflect.preventExtensions(target);
    };
    proxy = new Proxy(target, {
      get: (_, key, receiver) => {
        this.assert();
        const own = Reflect.getOwnPropertyDescriptor(target, key);
        if (own && !own.configurable && 'value' in own && !own.writable) return own.value;
        return request('get', key, receiver);
      },
      set: (_, key, value, receiver) => request('set', key, value, receiver),
      has: (_, key) => request('has', key),
      deleteProperty: (_, key) => {
        const ok = request('delete', key);
        if (ok) Reflect.deleteProperty(target, key);
        return ok;
      },
      ownKeys: () => {
        if (!Reflect.isExtensible(target)) mirror();
        return Object.values(request('keys')) as (string | symbol)[];
      },
      getOwnPropertyDescriptor: (_, key) => descriptor(key),
      defineProperty: (_, key, definition) => {
        const ok = request('define', key, definition);
        if (ok) descriptor(key);
        return ok;
      },
      isExtensible: () => {
        const result = request('isExtensible');
        if (!result) mirror();
        return result;
      },
      preventExtensions: () => {
        const result = request('preventExtensions');
        if (result) mirror();
        return result;
      },
      getPrototypeOf: () => request('prototype'),
      setPrototypeOf: (_, proto) => request('setPrototype', proto),
      apply: (_, receiver, args) => request('apply', receiver, ...args),
      construct: (_, args, newTarget) => request('construct', newTarget, ...args),
    });
    this.imported.set(ref.id, proxy);
    this.remotes.set(proxy, ref.id);
    return proxy;
  }
}
