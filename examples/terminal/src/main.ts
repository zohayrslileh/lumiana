import { connect } from 'lumiana/client';
import '@xterm/xterm/css/xterm.css';
import './style.css';

const status = document.querySelector<HTMLElement>('#status');

try {
  await connect.credentials({ username: 'lumiana', password: 'lumiana' });
  await import('./terminal');
} catch (error) {
  if (status) status.textContent = 'Disconnected';
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  document.querySelector('#terminal')!.textContent = message;
}
