import { createRequire } from 'node:module';
import path from 'node:path';
import { encodeValue } from '../values.js';

type Descriptor =
  | { kind: 'copy'; value: any }
  | {
      kind: 'resource';
      handle: number;
      type: 'function' | 'object' | 'array';
      name?: string;
      constructible?: boolean;
      properties: PropertyDescriptorRecord[];
      prototype?: Descriptor;
    }
  | { kind: 'handle'; handle: number }
  | { kind: 'promise'; handle: number };

interface PropertyDescriptorRecord {
  key: string;
  configurable: boolean;
  enumerable: boolean;
  kind: 'data' | 'accessor';
  writable?: boolean;
  value?: Descriptor;
  get?: boolean;
}

/** Native-addon state is an explicit host resource; package JavaScript never enters this kernel. */
export class AddonKernel {
  private values = new Map<number, any>();
  private handles = new WeakMap<object, number>();
  private promises = new Map<number, Promise<any>>();
  private callbacks = new Map<number, Function>();

  constructor(
    private root: string,
    private allocate: () => number,
    private invokeCallback: (id: number, receiver: Descriptor, args: Descriptor[]) => any,
  ) {
    this.require = createRequire(path.join(root, 'package.json'));
  }

  private require: NodeRequire;

  close(): void {
    this.values.clear();
    this.promises.clear();
    this.callbacks.clear();
  }

  private value(handle: number): any {
    if (!this.values.has(handle)) throw new ReferenceError(`Unknown native-addon handle ${handle}`);
    return this.values.get(handle);
  }

  private describe(value: any, expanding = new Set<number>()): Descriptor {
    try {
      encodeValue(value);
      return { kind: 'copy', value };
    } catch {}
    if (value instanceof Promise) {
      const handle = this.allocate();
      this.promises.set(handle, value);
      return { kind: 'promise', handle };
    }
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
      throw new TypeError(`Unsupported native-addon value ${typeof value}`);
    let handle = this.handles.get(value);
    if (handle === undefined) {
      handle = this.allocate();
      this.handles.set(value, handle);
      this.values.set(handle, value);
    }
    if (expanding.has(handle)) return { kind: 'handle', handle };
    expanding.add(handle);
    const properties: PropertyDescriptorRecord[] = [];
    for (const key of Object.getOwnPropertyNames(value)) {
      if (typeof value === 'function' && ['name', 'length', 'arguments', 'caller'].includes(key))
        continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      const property: PropertyDescriptorRecord = {
        key,
        configurable: descriptor.configurable ?? true,
        enumerable: descriptor.enumerable ?? false,
        kind: 'value' in descriptor ? 'data' : 'accessor',
        writable: 'writable' in descriptor ? descriptor.writable : Boolean(descriptor.set),
      };
      if ('value' in descriptor) {
        const described = this.describe(descriptor.value, expanding);
        // Behavioral values are stable capability references. Include them in the
        // containing resource graph so reading a method is always local. Copyable
        // data remains live and is read through its own boundary operation.
        if (described.kind !== 'copy' || key === 'prototype') property.value = described;
      } else property.get = typeof descriptor.get === 'function';
      properties.push(property);
    }
    const prototype = Object.getPrototypeOf(value);
    const includePrototype =
      prototype &&
      prototype !== Object.prototype &&
      prototype !== Function.prototype &&
      prototype !== Array.prototype;
    const result: Descriptor = {
      kind: 'resource',
      handle,
      type: typeof value === 'function' ? 'function' : Array.isArray(value) ? 'array' : 'object',
      ...(typeof value === 'function'
        ? {
            name: value.name,
            constructible: (() => {
              try {
                Reflect.construct(String, [], value);
                return true;
              } catch {
                return false;
              }
            })(),
          }
        : {}),
      properties,
      ...(includePrototype ? { prototype: this.describe(prototype, expanding) } : {}),
    };
    expanding.delete(handle);
    return result;
  }

  private unpack(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && typeof value.__lumianaAddon === 'number')
      return this.value(value.__lumianaAddon);
    if (Object.keys(value).length === 1 && typeof value.__lumianaCallback === 'number') {
      const id = value.__lumianaCallback;
      let callback = this.callbacks.get(id);
      if (!callback) {
        const kernel = this;
        callback = function (this: any, ...args: any[]) {
          const receiver = this === globalThis ? undefined : this;
          return kernel.unpack(
            kernel.invokeCallback(
              id,
              kernel.describe(receiver),
              args.map((value) => kernel.describe(value)),
            ),
          );
        };
        this.callbacks.set(id, callback);
      }
      return callback;
    }
    if (Array.isArray(value)) return value.map((item) => this.unpack(item));
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Date)
      return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.unpack(item)]));
  }

  async execute(operation: string, args: any[]): Promise<any> {
    if (operation !== 'addon.await') return this.executeSync(operation, args);
    const promise = this.promises.get(args[0]);
    if (!promise) throw new ReferenceError(`Unknown native-addon promise ${args[0]}`);
    this.promises.delete(args[0]);
    return this.describe(await promise);
  }

  executeSync(operation: string, args: any[]): any {
    switch (operation) {
      case 'addon.load':
        return this.describe(
          args[1] ? createRequire(path.join(this.root, args[1]))(args[0]) : this.require(args[0]),
        );
      case 'addon.get':
        return this.describe(Reflect.get(this.value(args[0]), args[1], this.value(args[0])));
      case 'addon.set':
        Reflect.set(this.value(args[0]), args[1], this.unpack(args[2]), this.value(args[0]));
        return undefined;
      case 'addon.apply':
        return this.describe(
          Reflect.apply(
            this.value(args[0]),
            args[1] === undefined ? undefined : this.value(args[1]),
            this.unpack(args[2]),
          ),
        );
      case 'addon.construct':
        return this.describe(Reflect.construct(this.value(args[0]), this.unpack(args[1])));
      default:
        throw new TypeError(`Unknown native-addon operation ${operation}`);
    }
  }
}
