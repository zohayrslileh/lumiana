import os from 'node:os';
import childProcess from 'node:child_process';
import { threadId } from 'node:worker_threads';

/** Host operating-system queries whose Node contract is synchronous and live. */
export class SystemKernel {
  executeSync(operation: string, args: any[]): any {
    if (operation === 'system.threadId') return threadId;
    if (operation.startsWith('child.')) {
      const name = operation.slice('child.'.length);
      const fn = (childProcess as any)[name];
      if (typeof fn !== 'function')
        throw new TypeError(`Unknown child-process operation ${operation}`);
      return Reflect.apply(fn, childProcess, args);
    }
    if (!operation.startsWith('os.')) throw new TypeError(`Unknown system operation ${operation}`);
    const name = operation.slice('os.'.length);
    const fn = (os as any)[name];
    if (typeof fn !== 'function') throw new TypeError(`Unknown system operation ${operation}`);
    return Reflect.apply(fn, os, args);
  }
}
