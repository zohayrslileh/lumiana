import http from 'node:http';
import https from 'node:https';
import { key, cert } from '../fixtures/tls';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const messages: string[] = [];
  for (const secure of [false, true]) {
    const api = secure ? https : http;
    let connections = 0;
    const server = secure
      ? https.createServer({ key, cert }, (req, res) => res.end(req.url))
      : http.createServer((req, res) => res.end(req.url));
    server.on('connection', () => connections++);
    const agent = new api.Agent({
      keepAlive: true,
      maxSockets: 1,
      ...(secure ? { ca: cert } : {}),
    });
    server.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const port = (server.address() as { port: number }).port;
      const requests = Array.from({ length: 5 }, (_, index) =>
        (async () => {
          const request = api.get({ host: '127.0.0.1', port, path: '/' + index, agent });
          const [response] = await once(request, 'response');
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (text += chunk));
          await once(response, 'end');
          assert.equal(text, '/' + index);
          return request;
        })(),
      );
      const results = await Promise.all(requests);
      assert.equal(connections, 1);
      assert.equal(results.filter((request) => request.reusedSocket).length, 4);
      messages.push(`${secure ? 'HTTPS' : 'HTTP'}: five queued requests reused one socket.`);
    } finally {
      agent.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  output.textContent = messages.join('\n') + '\nPool scheduling runs in the browser.';
}
