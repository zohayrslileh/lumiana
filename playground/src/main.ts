import { lumiana } from 'virtual:lumiana';

const pingBtn = document.getElementById('ping-btn') as HTMLButtonElement;
const outputEl = document.getElementById('output') as HTMLElement;
const indicatorEl = document.getElementById('status-indicator') as HTMLElement;
const modeBadge = document.getElementById('mode-badge') as HTMLElement;
const uptimeVal = document.getElementById('uptime-value') as HTMLElement;
const latencyVal = document.getElementById('latency-value') as HTMLElement;

async function executePing() {
  outputEl.textContent = 'Pinging internal backend server...';
  indicatorEl.className = 'status-indicator ready';

  const startTime = performance.now();
  try {
    // Calling lumiana.ping()
    const result = await lumiana.ping();
    const duration = Math.round(performance.now() - startTime);

    indicatorEl.className = 'status-indicator success';
    outputEl.textContent = JSON.stringify(result, null, 2);

    modeBadge.textContent = result.mode;
    modeBadge.style.backgroundColor = result.mode === 'production' ? '#238636' : '#1f6feb';
    uptimeVal.textContent = `${result.uptime}s`;
    latencyVal.textContent = `${duration}ms`;
  } catch (err) {
    indicatorEl.className = 'status-indicator error';
    outputEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

pingBtn.addEventListener('click', executePing);

// Auto-ping on load
executePing();
