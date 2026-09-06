import './style.css';
import { connect, lumiana } from 'lumiana/client';

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
