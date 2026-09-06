import { useState } from 'react';
import * as grpc from '@grpc/grpc-js';

type HelloRequest = {
  name: string;
};

type HelloResponse = {
  message: string;
};

const serialize = (value: unknown) => Buffer.from(JSON.stringify(value));

const deserialize = <T,>(buffer: Buffer): T => JSON.parse(buffer.toString());

const service = {
  sayHello: {
    path: '/test.Greeter/SayHello',

    requestStream: false,
    responseStream: false,

    requestSerialize: serialize,
    requestDeserialize: (buffer: Buffer) => deserialize<HelloRequest>(buffer),

    responseSerialize: serialize,
    responseDeserialize: (buffer: Buffer) => deserialize<HelloResponse>(buffer),
  },
} satisfies grpc.ServiceDefinition;

const Client = grpc.makeGenericClientConstructor(service, 'Greeter');

let server: grpc.Server | null = null;

export function App() {
  const [status, setStatus] = useState('Ready');
  const [result, setResult] = useState('');

  async function startServer() {
    if (server) {
      setStatus('Server already running');
      return;
    }

    server = new grpc.Server();

    server.addService(service, {
      sayHello(
        call: grpc.ServerUnaryCall<HelloRequest, HelloResponse>,
        callback: grpc.sendUnaryData<HelloResponse>,
      ) {
        callback(null, {
          message: `Hello ${call.request.name} from gRPC`,
        });
      },
    });

    await new Promise<void>((resolve, reject) => {
      server!.bindAsync('127.0.0.1:50051', grpc.ServerCredentials.createInsecure(), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    setStatus('gRPC server running on :50051');
  }

  async function callServer() {
    setStatus('Calling gRPC...');

    const client = new Client('127.0.0.1:50051', grpc.credentials.createInsecure());

    const response = await new Promise<HelloResponse>((resolve, reject) => {
      client.sayHello(
        {
          name: 'Example User',
        },
        (error: grpc.ServiceError | null, response: HelloResponse) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(response);
        },
      );
    });

    client.close();

    setResult(JSON.stringify(response, null, 2));
    setStatus('Done');
  }

  function stopServer() {
    if (!server) return;

    server.forceShutdown();
    server = null;

    setStatus('Stopped');
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>gRPC + React + Lumiana</h1>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={startServer}>Start gRPC</button>

        <button onClick={callServer}>Call gRPC</button>

        <button onClick={stopServer}>Stop</button>
      </div>

      <p>{status}</p>

      <pre>{result}</pre>
    </main>
  );
}
