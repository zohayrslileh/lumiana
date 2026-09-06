import tls from 'node:tls';

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
  constructor(private allocate: () => number) {}

  options(input: any = {}) {
    const { secureContext, ...options } = input;
    if (secureContext !== undefined) {
      const context = this.contexts.get(secureContext);
      if (!context) throw new ReferenceError(`Unknown TLS context handle ${secureContext}`);
      options.secureContext = context;
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
    if (operation === 'tls.checkServerIdentity') {
      const error = tls.checkServerIdentity(args[0], args[1]);
      return error ? { ...error, name: error.name, message: error.message } : undefined;
    }
    if (operation === 'tls.getCiphers') return tls.getCiphers();
    if (operation === 'tls.getCACertificates') return tls.getCACertificates(args[0]);
    throw new TypeError(`Unknown TLS operation ${operation}`);
  }

  close() {
    this.contexts.clear();
  }
}
