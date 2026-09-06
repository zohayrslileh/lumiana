import { useState } from "react";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    message: "Hello from Hono",
    runtime: "Lumiana",
    time: Date.now(),
  });
});

app.get("/users/:id", (c) => {
  return c.json({
    id: c.req.param("id"),
    name: "Zohayr",
  });
});

let server: ReturnType<typeof serve> | null = null;

export function App() {
  const [status, setStatus] = useState("Stopped");
  const [result, setResult] = useState("");

  async function start() {
    if (server) {
      setStatus("Already running");
      return;
    }

    server = serve({
      fetch: app.fetch,
      port: 3000,
    });

    setStatus("Running on http://localhost:3000");
  }

  async function test() {
    setStatus("Requesting...");

    const response = await fetch("http://localhost:3000/users/123");
    const data = await response.json();

    setResult(JSON.stringify(data, null, 2));
    setStatus(`HTTP ${response.status}`);
  }

  function stop() {
    if (!server) return;

    server.close();
    server = null;

    setStatus("Stopped");
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Hono + React + Lumiana</h1>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={start}>Start Hono</button>
        <button onClick={test}>Test request</button>
        <button onClick={stop}>Stop</button>
      </div>

      <p>{status}</p>

      <pre>{result}</pre>
    </main>
  );
}