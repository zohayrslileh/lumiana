import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Resolve CommonJS requests against the source module represented in the browser bundle. */
export class ModuleKernel {
  constructor(private root: string) {}

  executeSync(operation: string, args: any[]): any {
    if (operation !== 'module.resolve')
      throw new TypeError(`Unknown module operation ${operation}`);
    const [specifier, sourceOrigin, options] = args;
    const source = String(sourceOrigin || 'package.json').split('?')[0]!;
    const anchor = source.startsWith('file:')
      ? fileURLToPath(source)
      : path.isAbsolute(source)
        ? source
        : path.resolve(this.root, source);
    return createRequire(anchor).resolve(specifier, options);
  }
}
