import { parse, stringify } from 'yaml';
import { assert } from '../check';

export async function run(output: HTMLElement) {
  const value = { title: 'DOM + Node', message: 'sample 🌍', enabled: true, items: [1, 2, 3] };
  const text = stringify(value);
  assert.deepEqual(parse(text), value);
  output.textContent = 'Pure JavaScript parsing and formatting stay in the browser:\n' + text;
}
