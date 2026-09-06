import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';

/** Per-connection DNS resolvers; JavaScript resolver objects stay in the browser. */
export class DnsKernel {
  private resolvers = new Map<number, dnsPromises.Resolver>();

  constructor(private allocate: () => number) {}

  close(): void {
    for (const resolver of this.resolvers.values()) resolver.cancel();
    this.resolvers.clear();
  }

  private resolver(handle: number): dnsPromises.Resolver {
    const resolver = this.resolvers.get(handle);
    if (!resolver) throw new ReferenceError(`Unknown DNS resolver ${handle}`);
    return resolver;
  }

  executeSync(operation: string, args: any[]): any {
    if (operation === 'dns.resolver.create') {
      const handle = this.allocate();
      this.resolvers.set(handle, new dnsPromises.Resolver(args[0]));
      return handle;
    }
    if (operation === 'dns.resolver.method') {
      const resolver = this.resolver(Number(args[0]));
      const method = String(args[1]);
      const target = (resolver as any)[method];
      if (typeof target !== 'function')
        throw new TypeError(`Unknown DNS resolver method ${method}`);
      const value = Reflect.apply(target, resolver, args.slice(2));
      return value === resolver ? undefined : value;
    }
    const method = operation.slice('dns.'.length);
    const target = (dns as any)[method];
    if (!operation.startsWith('dns.') || typeof target !== 'function')
      throw new TypeError(`Unknown DNS operation ${operation}`);
    return Reflect.apply(target, dns, args);
  }

  async execute(operation: string, args: any[]): Promise<any> {
    if (operation === 'dns.resolver.query') {
      const resolver = this.resolver(Number(args[0]));
      const method = String(args[1]);
      const target = (resolver as any)[method];
      if (typeof target !== 'function')
        throw new TypeError(`Unknown DNS resolver method ${method}`);
      return Reflect.apply(target, resolver, args.slice(2));
    }
    const method = operation.slice('dns.'.length);
    const target = (dnsPromises as any)[method];
    if (!operation.startsWith('dns.') || typeof target !== 'function')
      throw new TypeError(`Unknown DNS operation ${operation}`);
    return Reflect.apply(target, dnsPromises, args);
  }
}
