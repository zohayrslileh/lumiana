import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { connect } from 'lumiana/client';

try {
  await connect.credentials({ username: 'lumiana', password: 'lumiana' });
  await import('./App.tsx');
} catch (error) {
  document.body.textContent =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
