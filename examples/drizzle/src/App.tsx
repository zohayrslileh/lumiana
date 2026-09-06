import { useEffect, useState } from 'react';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const users = sqliteTable('users', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  email: text().notNull().unique(),
});

const db = drizzle('./test.db');

db.run(sql`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  )
`);

type User = {
  id: number;
  name: string;
  email: string;
};

export default function App() {
  const [rows, setRows] = useState<User[]>([]);

  function refresh() {
    const result = db.select().from(users).all();
    setRows(result);
  }

  function addUser() {
    db.insert(users)
      .values({
        name: 'Sample User',
        email: `sample-${crypto.randomUUID()}@example.com`,
      })
      .run();

    refresh();
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main>
      <h1>Drizzle + SQLite + React</h1>

      <button onClick={addUser}>Add user</button>

      <ul>
        {rows.map((user) => (
          <li key={user.id}>
            {user.id} — {user.name} — {user.email}
          </li>
        ))}
      </ul>
    </main>
  );
}
