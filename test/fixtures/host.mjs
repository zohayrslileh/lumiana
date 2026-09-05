import http from 'node:http';
import { WebSocketServer } from 'ws';
import { attachHost } from '../../dist/host.js';
const server = http.createServer((req, res) =>
  host.handle(req, res, () => {
    res.end('browser');
  }),
);
const host = attachHost(server, { root: process.cwd(), username: 'test', password: 'secret' });
const other = http.createServer((req, res) => {
  if (req.url === '/slow') {
    setTimeout(() => res.end('late'), 2000).unref();
    return;
  }
  let bytes = [];
  req.on('data', (b) => bytes.push(b));
  req.on('end', () => res.end(bytes.length ? Buffer.concat(bytes) : 'remote'));
});
const echo = new WebSocketServer({ noServer: true });
for (const http of [server, other])
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/echo') return;
    echo.handleUpgrade(req, socket, head, (ws) =>
      ws.on('message', (data, binary) => ws.send(data, { binary })),
    );
  });
other.listen(0, '127.0.0.1', () =>
  server.listen(0, '127.0.0.1', () =>
    process.send({
      port: server.address().port,
      otherPort: other.address().port,
      pid: process.pid,
    }),
  ),
);
process.on('message', async () => {
  await host.close();
  for (const ws of echo.clients) ws.terminate();
  echo.close();
  other.closeAllConnections();
  other.close();
  server.close(() => process.exit());
});
