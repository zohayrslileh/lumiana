import Database from 'better-sqlite3';

const database = new Database(':memory:');

database.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL
    )
  `);

const insert = database.prepare('INSERT INTO messages (text) VALUES (?)');

insert.run('Hello from Lumiana');

const messages = database.prepare('SELECT * FROM messages').all();

console.log(messages);

database.close();
