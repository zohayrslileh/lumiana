import { useState } from "react";
import Database from "better-sqlite3";

const db = new Database("./better-test.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  )
`);

export function App() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState("Ready");

  function insertUser() {
    const email =
      `zohayr-${crypto.randomUUID()}@example.com`;

    const stmt = db.prepare(`
      INSERT INTO users (name, email)
      VALUES (?, ?)
    `);

    const result = stmt.run(
      "Zohayr",
      email
    );

    console.log("insert:", result);

    const users = db
      .prepare("SELECT * FROM users ORDER BY id")
      .all();

    setRows(users);
    setStatus(
      `Inserted ID: ${String(result.lastInsertRowid)}`
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>better-sqlite3 + React + Lumiana</h1>

      <button onClick={insertUser}>
        Insert user
      </button>

      <p>{status}</p>

      <pre>
        {JSON.stringify(rows, null, 2)}
      </pre>
    </main>
  );
}