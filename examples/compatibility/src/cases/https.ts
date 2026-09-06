import https from 'node:https';
import { ClientRequest } from 'node:http';
import tls from 'node:tls';
import net from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { Buffer } from 'node:buffer';
import { key, cert } from '../fixtures/tls';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const server = https.createServer({ key, cert }, (request, response) => {
    assert.equal((request.socket as tls.TLSSocket).encrypted, true);
    response.setHeader('Content-Type', 'application/octet-stream');
    request.pipe(response);
  });
  const websocket = new WebSocketServer({ server, perMessageDeflate: true });
  websocket.on('connection', (socket) =>
    socket.on('message', (bytes, binary) => socket.send(bytes, { binary })),
  );
  let client: WebSocket | undefined;
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const request = https.request(`https://localhost:${port}/echo`, {
      ca: cert,
      family: 4,
      method: 'POST',
    });
    assert.equal(request instanceof ClientRequest, true);
    const response = once(request, 'response');
    const payload = Buffer.from('DOM + HTTPS — sample 🌍');
    request.end(payload);
    const [incoming] = await response;
    assert.equal(incoming.socket instanceof tls.TLSSocket, true);
    assert.equal(incoming.socket instanceof net.Socket, true);
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    await once(incoming, 'end');
    assert.deepEqual(Buffer.concat(chunks), payload);
    client = new WebSocket(`wss://localhost:${port}/socket`, { ca: cert, family: 4 });
    await once(client, 'open');
    const binary = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256));
    const echoed = once(client, 'message');
    client.send(binary);
    const [bytes, isBinary] = await echoed;
    assert.equal(isBinary, true);
    assert.deepEqual(Buffer.from(bytes), binary);
    assert.equal(client.extensions, 'permessage-deflate');
    const closed = once(client, 'close');
    client.close(1000);
    assert.equal((await closed)[0], 1000);
    output.textContent =
      'HTTPS streamed an exact Unicode body over verified TLS.\nOriginal ws upgraded to WSS, compressed and echoed 4,096 binary bytes, and closed cleanly.';
  } finally {
    client?.terminate();
    for (const peer of websocket.clients) peer.terminate();
    await new Promise<void>((resolve) => websocket.close(() => resolve()));
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
