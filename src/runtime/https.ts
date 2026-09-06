import { Buffer } from 'buffer';
import { kernelCall, kernelSubscribe } from './bridge.js';
import { createHttp } from './http-core.js';
import { Agent as HttpAgent, httpClient } from './http.js';
import { tlsRuntime } from './tls.js';

const server = createHttp(kernelCall, kernelSubscribe, tlsRuntime);
export const { Server, createServer } = server;
export class Agent extends HttpAgent {
  constructor(options: any = {}) {
    super(options);
  }
  private identities = new WeakMap<object, number>();
  private identitySequence = 0;
  private optionKey(value: any): any {
    if (Array.isArray(value)) return value.map((item) => this.optionKey(item));
    if (ArrayBuffer.isView(value))
      return [
        'bytes',
        Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex'),
      ];
    if (value && (typeof value === 'object' || typeof value === 'function')) {
      if (!this.identities.has(value)) this.identities.set(value, ++this.identitySequence);
      return ['reference', this.identities.get(value)];
    }
    return value;
  }
  defaultPort = 443;
  protocol = 'https:';
  getName(options: any = {}) {
    const fields = [
      'ca',
      'cert',
      'key',
      'pfx',
      'ciphers',
      'rejectUnauthorized',
      'servername',
      'minVersion',
      'maxVersion',
      'secureProtocol',
      'secureOptions',
      'sessionIdContext',
      'secureContext',
      'checkServerIdentity',
      'pskCallback',
      'ALPNProtocols',
      'sigalgs',
      'ecdhCurve',
      'crl',
      'passphrase',
    ];
    return (
      super.getName(options) +
      ':' +
      JSON.stringify(fields.map((key) => this.optionKey(options[key])))
    );
  }
  createConnection(options: any, callback?: any) {
    return tlsRuntime.connect(options, callback);
  }
}
export const globalAgent = new Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 });
const client = httpClient.withTransport({
  protocol: 'https:',
  defaultPort: 443,
  createConnection: tlsRuntime.connect,
  globalAgent,
});
export const { request, get } = client;
export default { Agent, globalAgent, Server, createServer, request, get };
