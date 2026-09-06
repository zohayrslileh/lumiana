import WebSocket, { WebSocketServer } from 'ws';
import { Buffer } from 'node:buffer';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  let port = 0;
  for (let round = 1; round <= 2; round++) {
    const server = new WebSocketServer({ host: '127.0.0.1', port, perMessageDeflate: true });
    const clients: WebSocket[] = [];
    const errors: Error[] = [];
    server.on('error', (error) => errors.push(error));
    server.on('connection', (socket) => {
      socket.on('error', (error) => errors.push(error));
      socket.on('message', (data, binary) => {
        for (const peer of server.clients)
          if (peer.readyState === WebSocket.OPEN) peer.send(data, { binary });
      });
    });
    try {
      await once(server, 'listening');
      port = (server.address() as { port: number }).port;
      for (let i = 0; i < 2; i++) {
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        clients.push(client);
        client.on('error', (error) => errors.push(error));
        await once(client, 'open');
      }
      const counts = [0, 0];
      clients.forEach((client, index) => client.on('message', () => counts[index]++));
      for (const payload of [
        'Hello — sample 🌍',
        Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)),
      ]) {
        const responses = Promise.all(clients.map((client) => once(client, 'message')));
        clients[0].send(payload);
        for (const [bytes, binary] of await responses) {
          assert.equal(binary, typeof payload !== 'string');
          assert.deepEqual(Buffer.from(bytes), Buffer.from(payload));
        }
      }
      assert.deepEqual(counts, [2, 2]);
      assert.deepEqual(errors, []);
      const pong = once(clients[0], 'pong');
      clients[0].ping('alive');
      assert.equal(Buffer.from((await pong)[0]).toString(), 'alive');
      assert.equal(clients[0].extensions, 'permessage-deflate');
      const closed = Promise.all(clients.map((client) => once(client, 'close')));
      clients.forEach((client) => client.close(1000));
      for (const [code] of await closed) assert.equal(code, 1000);
      output.textContent = `Round ${round}: two clients, compressed Unicode and 4,096 binary bytes broadcast exactly; ping/pong and clean close.\n`;
    } finally {
      clients.forEach((client) => client.terminate());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  output.textContent += 'Restarted on the same port; no duplicate message callbacks.';
}
