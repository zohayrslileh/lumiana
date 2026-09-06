export { default as assert } from 'node:assert/strict';
export function once(emitter: any, event: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${event}`)), 8000);
    const receive = (...args: any[]) => finish(undefined, args);
    const failed = (error: Error) => finish(error);
    function finish(error?: Error, args: any[] = []) {
      clearTimeout(timeout);
      emitter.off(event, receive);
      emitter.off('error', failed);
      error ? reject(error) : resolve(args);
    }
    emitter.once(event, receive);
    emitter.once('error', failed);
  });
}
