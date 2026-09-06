import './style.css';
import { connect, lumiana } from 'lumiana/client';

document.querySelector<HTMLElement>('#app')!.innerHTML = `
  <section class="counter" aria-labelledby="title">
    <p class="eyebrow">Lumiana shared Worker</p>
    <h1 id="title">A counter that outlives the page</h1>
    <p class="description">
      Change the value, reload this page, or open another tab. Every browser session attaches to
      the same Worker instance.
    </p>

    <output class="value" aria-live="polite" aria-label="Counter value">—</output>

    <div class="controls" aria-label="Counter controls">
      <button type="button" data-action="decrement" aria-label="Decrease counter">−</button>
      <button type="button" data-action="increment" aria-label="Increase counter">+</button>
    </div>

    <button class="reset" type="button" data-action="reset">Reset to zero</button>
    <p class="status" role="status">Connecting to Lumiana…</p>
  </section>
`;

const value = document.querySelector<HTMLOutputElement>('.value')!;
const status = document.querySelector<HTMLElement>('.status')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];

try {
  await connect.credentials({ username: 'lumiana', password: 'lumiana' });
  const counter = await lumiana.sharedWorker(() => import('./counter.worker'));

  const render = (next: number) => {
    value.value = String(next);
    value.textContent = String(next);
  };

  render(await counter.current());
  status.textContent = 'Connected. This value is shared with every open tab.';

  document.querySelector('[data-action="decrement"]')!.addEventListener('click', () => {
    void counter.decrement();
  });
  document.querySelector('[data-action="increment"]')!.addEventListener('click', () => {
    void counter.increment();
  });
  document.querySelector('[data-action="reset"]')!.addEventListener('click', () => {
    void counter.reset();
  });

  for await (const next of counter.changes()) render(next);
} catch (error) {
  for (const button of buttons) button.disabled = true;
  status.textContent = error instanceof Error ? error.message : String(error);
  status.classList.add('error');
}
