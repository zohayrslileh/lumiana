import { connect } from 'lumiana/client';
try {
  await connect.credentials({ username: 'lumiana', password: 'lumiana' });
  await import('./entry');
} catch (error) {
  document.body.textContent =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
}
