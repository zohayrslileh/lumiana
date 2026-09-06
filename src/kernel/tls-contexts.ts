import tls from 'node:tls';

export interface NativeCallbacks {
  sync: (id: number, args: any[]) => any;
  async: (id: number, args: any[]) => Promise<any>;
}

/** Negotiated state is immutable between handshakes and travels with the socket event. */
export function tlsInfo(socket: tls.TLSSocket) {
  return {
    encrypted: true,
    authorized: socket.authorized,
    authorizationError: socket.authorizationError,
    alpnProtocol: socket.alpnProtocol,
    servername: socket.servername,
    tls: {
      certificate: socket.getCertificate(),
      peerCertificate: socket.getPeerCertificate(true),
      cipher: socket.getCipher(),
      protocol: socket.getProtocol(),
      ephemeralKeyInfo: socket.getEphemeralKeyInfo(),
      session: socket.getSession(),
      sessionReused: socket.isSessionReused(),
      sharedSigalgs: socket.getSharedSigalgs(),
      finished: socket.getFinished(),
      peerFinished: socket.getPeerFinished(),
      ticket: socket.getTLSTicket(),
    },
  };
}

export class TlsContexts {
  private contexts = new Map<number, tls.SecureContext>();
  constructor(
    private allocate: () => number,
    private callbacks?: NativeCallbacks,
    private describeSocket?: (socket: tls.TLSSocket) => any,
  ) {}

  context(handle: number) {
    const value = this.contexts.get(handle);
    if (!value) throw new ReferenceError(`Unknown TLS context handle ${handle}`);
    return value;
  }

  options(input: any = {}) {
    const { secureContext, ...options } = input;
    if (secureContext !== undefined) {
      const context = this.contexts.get(secureContext);
      if (!context) throw new ReferenceError(`Unknown TLS context handle ${secureContext}`);
      options.secureContext = context;
    }
    for (const name of ['SNICallback', 'ALPNCallback', 'pskCallback']) {
      const id = options[name];
      if (typeof id !== 'number') continue;
      const callbacks = this.callbacks;
      if (!callbacks) throw new Error('Native callbacks are unavailable');
      if (name === 'SNICallback')
        options[name] = (servername: string, done: Function) => {
          void callbacks.async(id, [servername]).then(
            (handle) => done(null, handle === undefined ? undefined : this.context(handle)),
            (error) => done(error),
          );
        };
      else if (name === 'ALPNCallback') options[name] = (input: any) => callbacks.sync(id, [input]);
      else
        options[name] = (...args: any[]) =>
          callbacks.sync(
            id,
            args.map((arg) => (arg instanceof tls.TLSSocket ? this.describeSocket!(arg) : arg)),
          );
    }
    return options;
  }

  executeSync(operation: string, args: any[]) {
    if (operation === 'tls.context') {
      const context = tls.createSecureContext(args[0]);
      const handle = this.allocate();
      this.contexts.set(handle, context);
      return { handle };
    }
    if (operation === 'tls.getCiphers') return tls.getCiphers();
    if (operation === 'tls.getCACertificates') return tls.getCACertificates(args[0]);
    throw new TypeError(`Unknown TLS operation ${operation}`);
  }

  close() {
    this.contexts.clear();
  }
}
