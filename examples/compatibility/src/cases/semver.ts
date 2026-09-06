import semver from 'semver';
import { assert } from '../check';

export async function run(output: HTMLElement) {
  const versions = ['1.0.0', '2.0.0-beta.1', '1.8.2', '1.9.0', '2.0.0'];
  const selected = semver.maxSatisfying(versions, '^1.0.0');
  assert.equal(selected, '1.9.0');
  assert.equal(semver.satisfies('2.0.0-beta.1', '^2.0.0'), false);
  assert.equal(semver.inc(selected, 'patch'), '1.9.1');
  output.textContent = `Pure package code selected ${selected} and computed its next patch, entirely in the browser.`;
}
