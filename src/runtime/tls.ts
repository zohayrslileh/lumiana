import { kernelCall, kernelSubscribe, kernelCallSync } from './bridge.js';
import { network } from './socket-runtime.js';
import { createTls } from './tls-core.js';

export const tlsRuntime = createTls(kernelCall, kernelSubscribe, kernelCallSync, network);
export const {
  TLSSocket,
  Server,
  connect,
  createServer,
  createSecureContext,
  checkServerIdentity,
  getCiphers,
  getCACertificates,
} = tlsRuntime;
export default {
  TLSSocket,
  Server,
  connect,
  createServer,
  createSecureContext,
  checkServerIdentity,
  getCiphers,
  getCACertificates,
};
