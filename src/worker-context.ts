import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolveImport } from 'import-meta-resolve';
import { failure } from './protocol.js';
import { encodeValue } from './values.js';

export interface WorkerDescriptor {
  code: string;
  filename: string;
}

/** Creates the Node-only realm used by code that is moved across the browser boundary. */
export function createWorkerContext(
  descriptor: WorkerDescriptor,
  root: string,
  label: string,
  project: (packet: any) => void,
) {
  const filename = descriptor.filename.startsWith('file:')
    ? fileURLToPath(descriptor.filename)
    : path.resolve(root, descriptor.filename || `lumiana.${label}.js`);
  const require = createRequire(filename);
  const loadModule = new Function(
    'specifier',
    'attributes',
    'return import(specifier, attributes ? { with: attributes } : undefined)',
  ) as (specifier: string, attributes?: Record<string, string>) => Promise<any>;
  const module = { exports: {} as any };
  const workerConsole: Record<string, (...values: unknown[]) => void> = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const)
    workerConsole[level] = (...values: unknown[]) =>
      project({
        type: 'console',
        level,
        values: values.map((value) => {
          try {
            return encodeValue(value);
          } catch {
            return encodeValue(String(value));
          }
        }),
        errors: values.map((value) =>
          value instanceof Error ||
          (typeof value === 'object' &&
            value !== null &&
            Object.prototype.toString.call(value) === '[object Error]')
            ? failure(value)
            : null,
        ),
      });

  const sandbox: Record<string, any> = {
    Buffer,
    console: workerConsole,
    process,
    module,
    exports: module.exports,
    require,
    __filename: filename,
    __dirname: path.dirname(filename),
  };
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox, { name: `lumiana.${label}:${filename}` });
  return {
    filename,
    load(): any {
      new vm.Script(descriptor.code, {
        filename,
        importModuleDynamically: async (specifier, _script, attributes) => {
          const resolved = resolveImport(specifier, pathToFileURL(filename).href);
          const values = Object.fromEntries(
            Object.entries(attributes).filter((entry): entry is [string, string] => !!entry[1]),
          );
          return loadModule(resolved, Object.keys(values).length ? values : undefined);
        },
      }).runInContext(context);
      return module.exports;
    },
  };
}
