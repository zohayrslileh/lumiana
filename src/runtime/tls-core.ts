import { Buffer } from 'buffer';
import { createNetwork, socketOptions, type KernelSubscribe } from './network.js';
import type { KernelCall } from './filesystem.js';

type SyncCall = (operation: string, ...args: any[]) => any;

export function createTls(
  call: KernelCall,
  subscribe: KernelSubscribe,
  sync: SyncCall,
  network = createNetwork(call, subscribe),
): any {
  const contexts = new WeakMap<object, number>();
  const contextOptions = (options: any = {}) => {
    const result: any = {};
    for (const key of [
      'ALPNProtocols',
      'ca',
      'cert',
      'ciphers',
      'clientCertEngine',
      'crl',
      'dhparam',
      'ecdhCurve',
      'enableTrace',
      'honorCipherOrder',
      'key',
      'maxVersion',
      'minDHSize',
      'minVersion',
      'passphrase',
      'pfx',
      'privateKeyEngine',
      'privateKeyIdentifier',
      'rejectUnauthorized',
      'requestCert',
      'requestOCSP',
      'secureOptions',
      'secureProtocol',
      'servername',
      'session',
      'sessionIdContext',
      'sessionTimeout',
      'sigalgs',
      'ticketKeys',
      'handshakeTimeout',
      'allowHalfOpen',
      'pauseOnConnect',
    ])
      if (options[key] !== undefined) result[key] = options[key];
    if (options.secureContext !== undefined) {
      const handle = contexts.get(options.secureContext);
      if (handle === undefined)
        throw new TypeError('secureContext must be created by tls.createSecureContext');
      result.secureContext = handle;
    }
    for (const key of ['SNICallback', 'ALPNCallback', 'pskCallback'])
      if (options[key] !== undefined) throw new TypeError(`tls.${key} is not implemented`);
    return result;
  };
  function normalize(args: any[]) {
    if (typeof args[0] === 'object') return { ...args[0] };
    const options = args.find((value) => value && typeof value === 'object') ?? {};
    return { ...options, ...socketOptions(args) };
  }
  class TLSSocket extends network.Socket {
    encrypted = true;
    authorized = false;
    authorizationError: any = null;
    alpnProtocol: string | false = false;
    servername: string | false = false;
    private tls: any;
    private identity?: (hostname: string, certificate: any) => Error | undefined;
    private hostname = '';
    private rejectUnauthorized = true;
    constructor(options: any = {}) {
      super(options);
      if (options.handle !== undefined) Object.assign(this, options);
    }
    connect(...args: any[]) {
      const options = normalize(args);
      const callback = [...args].reverse().find((value) => typeof value === 'function');
      if (callback) this.once('secureConnect', callback);
      if (
        options.checkServerIdentity !== undefined &&
        typeof options.checkServerIdentity !== 'function'
      )
        throw new TypeError('checkServerIdentity must be a function');
      this.identity = options.checkServerIdentity;
      this.rejectUnauthorized = options.rejectUnauthorized !== false;
      this.hostname = options.servername || options.host || 'localhost';
      const input = {
        ...socketOptions([options]),
        ...contextOptions(options),
        customIdentity: Boolean(this.identity),
      };
      if (options.socket) {
        void network.takeSocket(options.socket).then(
          (handle: number) => {
            if (this.destroyed) {
              void call('net.destroy', handle);
              return;
            }
            this.open('tls.connect', { ...input, socket: handle });
          },
          (error: Error) => this.destroy(error),
        );
        return this;
      }
      return this.open('tls.connect', input);
    }
    protected incoming(event: string, args: any[]) {
      if (event === 'connect') {
        Object.assign(this, args[0]);
        this.connecting = false;
        this.emit('connect');
      } else if (event === 'secureConnect') {
        Object.assign(this, args[0]);
        if (this.authorized && this.identity) {
          let reason: Error | undefined;
          try {
            reason = this.identity(this.hostname, this.getPeerCertificate(true));
          } catch (error) {
            reason = error as Error;
          }
          if (reason) {
            this.authorized = false;
            this.authorizationError = (reason as any).code || reason.message;
            if (this.rejectUnauthorized) {
              this.destroy(reason);
              return;
            }
          }
        }
        if (this.destroyed) return;
        this.pending = false;
        this.connecting = false;
        this.readyState = 'open';
        this.writableReady = true;
        this.emit('secureConnect');
        if (!this.destroyed) {
          this.emit('_connected');
          void call('net.resume', this.handle);
        }
      } else if (event === 'session') {
        if (this.tls) this.tls.session = Buffer.from(args[0]);
        this.emit('session', Buffer.from(args[0]));
      } else super.incoming(event, args);
    }
    getPeerCertificate(detailed = false) {
      const certificate = this.tls?.peerCertificate;
      if (!certificate || this.destroyed) return {};
      if (detailed) return certificate;
      const { issuerCertificate, ...leaf } = certificate;
      return leaf;
    }
    getCertificate() {
      return this.tls?.certificate ?? {};
    }
    getCipher() {
      return this.tls?.cipher;
    }
    getProtocol() {
      return this.tls?.protocol ?? null;
    }
    getEphemeralKeyInfo() {
      return this.tls?.ephemeralKeyInfo;
    }
    getSession() {
      return this.tls?.session;
    }
    getSharedSigalgs() {
      return this.tls?.sharedSigalgs ?? [];
    }
    getTLSTicket() {
      return this.tls?.ticket;
    }
    getFinished() {
      return this.tls?.finished;
    }
    getPeerFinished() {
      return this.tls?.peerFinished;
    }
    isSessionReused() {
      return this.tls?.sessionReused ?? false;
    }
    exportKeyingMaterial(length: number, label: string, context?: Uint8Array) {
      return sync('tls.socket', this.handle, 'exportKeyingMaterial', length, label, context);
    }
    setMaxSendFragment(size: number) {
      return sync('tls.socket', this.handle, 'setMaxSendFragment', size);
    }
    disableRenegotiation() {
      return sync('tls.socket', this.handle, 'disableRenegotiation');
    }
  }
  class Server extends network.Server {
    constructor(options?: any, listener?: any) {
      if (typeof options === 'function') {
        listener = options;
        options = {};
      }
      super(contextOptions(options), listener, {
        operation: 'tls.server',
        event: 'secureConnection',
        Socket: TLSSocket,
      });
    }
  }
  function createSecureContext(options?: any) {
    const context = {};
    contexts.set(context, sync('tls.context', contextOptions(options)).handle);
    return context;
  }
  function checkServerIdentity(hostname: string, certificate: any) {
    const error = sync('tls.checkServerIdentity', hostname, certificate);
    return error ? Object.assign(new Error(error.message), error) : undefined;
  }
  const connect = (...args: any[]) => new TLSSocket().connect(...args);
  const createServer = (options?: any, listener?: any) => new Server(options, listener);
  return {
    TLSSocket,
    Server,
    connect,
    createConnection: connect,
    createServer,
    createSecureContext,
    checkServerIdentity,
    getCiphers: () => sync('tls.getCiphers'),
    getCACertificates: (type?: string) => sync('tls.getCACertificates', type),
    contextOptions,
  };
}
