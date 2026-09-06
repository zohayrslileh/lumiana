import { kernelCall, kernelSubscribe } from './bridge.js';
import { createHttp } from './http-core.js';
import { Agent as HttpAgent, httpClient } from './http.js';
import { tlsRuntime } from './tls.js';

const server = createHttp(kernelCall, kernelSubscribe, {
  operation: 'https.server',
  Socket: tlsRuntime.TLSSocket,
  options: (options: any) => ({ ...options, ...tlsRuntime.contextOptions(options) }),
});
const client = httpClient.withTransport({
  protocol: 'https:',
  defaultPort: 443,
  createConnection: tlsRuntime.connect,
});
export const { Server, createServer } = server;
export const { request, get } = client;
export class Agent extends HttpAgent {
  defaultPort = 443;
  protocol = 'https:';
  createConnection(options: any, callback?: any) {
    return tlsRuntime.connect(options, callback);
  }
}
export const globalAgent = new Agent();
export default { Agent, globalAgent, Server, createServer, request, get };
