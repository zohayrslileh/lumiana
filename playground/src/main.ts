import { lumiana, connect } from 'lumiana/client';

const button = document.getElementById('status-btn') as HTMLButtonElement;
const output = document.getElementById('output')!;

async function status() {
  try {
    await connect.credentials({ username: 'lumiana', password: 'lumiana' });
    const result = await lumiana.status();
    output.textContent = JSON.stringify(result, null, 2);
    document.getElementById('mode-badge')!.textContent = result.mode;
    document.getElementById('uptime-value')!.textContent = `${result.uptime.toFixed(1)}s`;
    document.getElementById('latency-value')!.textContent = `${result.latency.toFixed(1)}ms`;
  } catch (error) {
    output.textContent = String(error);
  }
}
button.addEventListener('click', status);
void status();
