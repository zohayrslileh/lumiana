import { useState } from 'react';
import * as esbuild from 'esbuild';

export function App() {
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState('Ready');

  async function compile() {
    setStatus('Compiling...');

    const source = `
      interface User {
        name: string;
        age: number;
      }

      const user: User = {
        name: "Example User",
        age: 30,
      };

      console.log(user);
    `;

    try {
      const result = await esbuild.transform(source, {
        loader: 'ts',
        target: 'es2022',
        format: 'esm',
      });

      setOutput(result.code);
      setStatus('Done');
    } catch (error) {
      setStatus(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>esbuild + React + Lumiana</h1>

      <button onClick={compile}>Compile TypeScript</button>

      <p>{status}</p>

      <pre
        style={{
          padding: 16,
          background: '#111',
          color: '#eee',
          overflow: 'auto',
        }}
      >
        {output}
      </pre>
    </main>
  );
}
