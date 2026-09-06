import express from 'express';
import { request } from 'node:http';
import { Buffer } from 'node:buffer';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const app = express();
  const events: string[] = [];
  let responseClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    responseClosed = resolve;
  });
  app.use((req, res, next) => {
    events.push('request');
    req.on('end', () => events.push('end'));
    res.on('finish', () => events.push('finish'));
    res.on('close', responseClosed);
    next();
  });
  app.use(express.json());
  app.post('/echo/:name', (req, res) => res.json({ name: req.params.name, value: req.body.value }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    output.textContent = 'Listening';
    const result = await new Promise<any>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${server.address().port}/echo/browser`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () => {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString()));
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      const timer = setTimeout(() => req.destroy(new Error('HTTP response timed out')), 8000);
      req.on('error', reject);
      req.on('close', () => clearTimeout(timer));
      req.end(JSON.stringify({ value: 'DOM + Node — sample' }));
    });
    assert.deepEqual(result, { name: 'browser', value: 'DOM + Node — sample' });
    await closed;
    assert.deepEqual(events, ['request', 'end', 'finish']);
    output.textContent =
      'Express routing and JSON middleware handled a real HTTP POST.\n' + JSON.stringify(result);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(resolve));
  }
}
