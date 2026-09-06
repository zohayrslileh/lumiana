import { connect } from 'lumiana/client';

const cases = import.meta.glob('./cases/*.ts') as Record<
  string,
  () => Promise<{ run(output: HTMLElement): Promise<void> }>
>;
document.querySelector('#app')!.innerHTML =
  `<style>body{font:16px system-ui;background:#f5f5f0;color:#263c30;margin:0}main{max-width:900px;margin:50px auto;padding:25px}h1{font-weight:550;letter-spacing:-1px}button{border:0;border-radius:8px;padding:11px 18px;background:#355b44;color:white;cursor:pointer}button:disabled{opacity:.4}article{background:white;border:1px solid #dce2d5;border-radius:12px;padding:20px;margin:15px 0}header{display:flex;align-items:center;justify-content:space-between}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;font-size:13px}p{color:#6f8069}article[data-status=passed]{border-color:#79a86e}article[data-status=failed]{border-color:#c46952}</style><h1>Node libraries, in the browser</h1><p>Each example runs original package code alongside the DOM and checks its results. Temporary files, sockets, and watchers are closed when a run finishes.</p><button id="all" disabled>Run all examples</button><span id="summary"> Connecting…</span><section id="cases"></section>`;
const runners: (() => Promise<void>)[] = [];
const disableButtons = (disabled: boolean) =>
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = disabled;
  });
for (const [path, load] of Object.entries(cases).sort(([a], [b]) =>
  a.includes('/ws.') ? -1 : b.includes('/ws.') ? 1 : a.localeCompare(b),
)) {
  const name = path.split('/').pop()!.replace('.ts', '');
  const card = document.createElement('article');
  card.dataset.example = name;
  card.innerHTML = `<header><strong>${name}</strong><button disabled>Run example</button></header><pre>Ready</pre>`;
  document.querySelector('#cases')!.append(card);
  const button = card.querySelector('button')!,
    output = card.querySelector('pre')!;
  const run = async () => {
    disableButtons(true);
    card.dataset.status = 'running';
    output.textContent = 'Running…';
    try {
      await (await load()).run(output);
      card.dataset.status = 'passed';
    } catch (error) {
      card.dataset.status = 'failed';
      output.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(error);
    } finally {
      disableButtons(false);
    }
  };
  runners.push(run);
  button.onclick = run;
}
try {
  await connect.credentials({ username: 'lumiana', password: 'lumiana' });
  // Resolve the test modules before enabling runs so Vite's initial dependency
  // optimization cannot interrupt an example midway through its assertions.
  await Promise.all(Object.values(cases).map((load) => load()));
  document.querySelectorAll('button').forEach((button) => (button.disabled = false));
  document.querySelector('#summary')!.textContent = ' Connected';
  document.querySelector<HTMLButtonElement>('#all')!.onclick = async () => {
    document.querySelector<HTMLButtonElement>('#all')!.disabled = true;
    for (const run of runners) await run();
    const passed = document.querySelectorAll('[data-status=passed]').length;
    document.querySelector('#summary')!.textContent = ` ${passed}/${runners.length} passed`;
    document.querySelector<HTMLButtonElement>('#all')!.disabled = false;
  };
} catch (error) {
  document.querySelector('#summary')!.textContent = String(error);
}
