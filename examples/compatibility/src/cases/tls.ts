import tls from 'node:tls';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { key, cert } from '../fixtures/tls';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const server = tls.createServer({ key, cert, ALPNProtocols: ['echo'] }, (socket) =>
    socket.pipe(socket),
  );
  const sockets: any[] = [];
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const tcp = net.connect({ host: '127.0.0.1', port });
    sockets.push(tcp);
    await once(tcp, 'connect');
    const socket = tls.connect({
      socket: tcp,
      ca: cert,
      servername: 'localhost',
      ALPNProtocols: ['echo'],
    });
    sockets.push(socket);
    await once(socket, 'secureConnect');
    assert.equal(socket instanceof net.Socket, true);
    assert.equal(socket instanceof tls.TLSSocket, true);
    assert.equal(socket.authorized, true);
    assert.equal(socket.alpnProtocol, 'echo');
    assert.equal(socket.getPeerCertificate().subject.CN, 'localhost');
    const bytes = Buffer.from([0, 127, 128, 255]);
    const echoed = once(socket, 'data');
    socket.write(bytes);
    assert.deepEqual(Buffer.from((await echoed)[0]), bytes);
    const closed = once(socket, 'close');
    socket.end();
    await closed;
    const rejected = tls.connect({
      host: '127.0.0.1',
      port,
      ca: cert,
      servername: 'wrong.example',
    });
    sockets.push(rejected);
    const rejectedClose = new Promise<void>((resolve) => rejected.once('close', resolve));
    const failure = await new Promise<any>((resolve) => rejected.once('error', resolve));
    assert.equal(failure.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    await rejectedClose;
    output.textContent =
      'TLS upgraded the existing TCP connection, verified its certificate, negotiated ALPN, and echoed binary bytes.\nA mismatched hostname was rejected.';
  } finally {
    sockets.forEach((socket) => socket.destroy());
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
