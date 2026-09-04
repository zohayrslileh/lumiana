# Lumiana ⚡

> Run Node.js APIs and DOM together in a single context with zero backend boilerplate.

Lumiana is a Vite plugin and runtime bridge that lets you import and execute Node.js code directly in your frontend application. Node APIs execute on the host server (or in-memory at 0ms), while your DOM renders seamlessly beside it.

---

## 🚀 Quick Start (3 Simple Steps)

### 1. Add the plugin in `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { lumiana } from 'lumiana';

export default defineConfig({
  plugins: [lumiana(), react()],
});
```

### 2. Connect in `src/main.tsx`

Open the bridge session and bootstrap your application entry point:

```tsx
import { connect } from 'lumiana/client';

// Connect with credentials and launch your app
const lumiana = await connect.credentials({
  username: 'lumiana',
  password: 'lumiana',
});

lumiana.run(() => import('./entry.tsx'));
```

### 3. Use Node.js & DOM in `src/entry.tsx`

Node APIs and DOM coexist in the exact same file without weird wrappers:

```tsx
import { createRoot } from 'react-dom/client';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ⚡ 1. Node.js code executes on the server / host
const files = await readdir('.');
const platform = os.platform();

// ⚡ 2. DOM renders right beside it in the same file
createRoot(document.getElementById('root')!).render(
  <div>
    <h1>Hello from Lumiana</h1>
    <p>Platform: {platform}</p>
    <p>Directory contents ({files.length} items):</p>
    <ul>
      {files.map((file) => (
        <li key={file}>{file}</li>
      ))}
    </ul>
  </div>
);
```

---

## ⚡ How It Works

1. **Direct Node Imports**:
   Import standard Node.js modules (`node:fs/promises`, `node:os`, `node:crypto`, `node:child_process`, etc.) directly in your components. Calls are bridged over a high-speed binary WebSocket protocol.

2. **0ms In-Memory Modules**:
   Modules like `node:path`, `node:events` (`EventEmitter`), `node:util`, and `node:buffer` execute instantly inside browser memory in 0ms with zero network roundtrips.

3. **Remote Host Execution**:
   Run arbitrary server-side logic using `lumiana.run`:
   ```ts
   const info = await lumiana.run(async ({ os, process }) => {
     return { pid: process.pid, arch: os.arch() };
   });
   ```

---

## 📦 Production Deployment

Lumiana uses an inverted architecture:

```bash
npm run build
```

This compiles your client assets and generates an all-in-one standalone host at `dist/main.js`:

```bash
node dist/main.js
```

Your application is served, authenticated, and ready on port `3883`.

---

## 🔒 Security & Options

You can configure credentials in `vite.config.ts`:

```ts
lumiana({
  username: 'your-username',
  password: 'your-strong-password',
})
```

All unauthorized WebSocket requests are rejected immediately with HTTP 401.

---

## License

MIT
