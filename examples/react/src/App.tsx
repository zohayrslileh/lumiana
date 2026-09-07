import { useState } from 'react';
import { createServer } from 'node:http';
import {
  request,
  Pool,
} from 'undici';

export function App() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');

  async function runTest() {
    setRunning(true);
    setResult('');

    const server = createServer((req, res) => {
      if (req.url === '/json') {
        res.setHeader('content-type', 'application/json');

        res.end(
          JSON.stringify({
            ok: true,
            source: 'Lumiana',
          })
        );

        return;
      }

      if (req.url === '/stream') {
        res.write('one\n');

        setTimeout(() => {
          res.write('two\n');
        }, 50);

        setTimeout(() => {
          res.end('three\n');
        }, 100);

        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    });

    let pool: Pool | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);

        server.listen(0, '127.0.0.1', () => {
          resolve();
        });
      });

      const address = server.address();

      if (!address || typeof address === 'string') {
        throw new Error('Could not determine port');
      }

      const origin =
        `http://127.0.0.1:${address.port}`;

      // Basic request
      const response = await request(
        `${origin}/json`
      );

      const json = await response.body.json();

      // Connection pool
      pool = new Pool(origin, {
        connections: 2,
        pipelining: 2,
      });

      const requests = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const response = await pool!.request({
            path: '/json',
            method: 'GET',
            headers: {
              'x-request-id': String(i),
            },
          });

          return response.body.json();
        })
      );

      // Streaming body
      const streamResponse = await pool.request({
        path: '/stream',
        method: 'GET',
      });

      let streamed = '';

      for await (const chunk of streamResponse.body) {
        streamed += chunk.toString();
      }

      setResult(
        JSON.stringify(
          {
            basicRequest: json,
            pooledRequests: requests.length,
            stream: streamed,
          },
          null,
          2
        )
      );
    } catch (error: unknown) {
      setResult(
        error instanceof Error
          ? error.stack ?? error.message
          : String(error)
      );
    } finally {
      await pool?.close();

      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });

      setRunning(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 900,
        margin: '40px auto',
        padding: 24,
        fontFamily: 'system-ui',
      }}
    >
      <h1>Undici × Lumiana</h1>

      <button
        onClick={runTest}
        disabled={running}
      >
        {running ? 'Running…' : 'Run Undici test'}
      </button>

      <pre
        style={{
          marginTop: 24,
          whiteSpace: 'pre-wrap',
        }}
      >
        {result}
      </pre>
    </main>
  );
}