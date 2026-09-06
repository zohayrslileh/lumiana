import spawn from 'cross-spawn';
import { Buffer } from 'node:buffer';
import { assert, once } from '../check';

export async function run(output: HTMLElement) {
  const child = spawn(process.execPath, [
    '-e',
    `process.stdout.write('child — sample');process.stderr.write('diagnostic')`,
  ]);
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0);
    assert.equal(Buffer.concat(stdout).toString(), 'child — sample');
    assert.equal(Buffer.concat(stderr).toString(), 'diagnostic');
    output.textContent =
      'Original cross-spawn launched Node.\nExact stdout/stderr received; child closed with code 0.';
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
