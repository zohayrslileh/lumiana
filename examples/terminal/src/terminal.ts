import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { spawn } from 'node-pty';

const container = document.querySelector<HTMLElement>('#terminal')!;
const status = document.querySelector<HTMLElement>('#status')!;
const terminal = new Terminal({
  allowProposedApi: false,
  convertEol: true,
  cursorBlink: true,
  cursorStyle: 'bar',
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  fontSize: 14,
  lineHeight: 1.25,
  scrollback: 10_000,
  theme: {
    background: '#07110f',
    foreground: '#d7e4df',
    cursor: '#43e6c2',
    cursorAccent: '#07110f',
    selectionBackground: '#275249',
    black: '#07110f',
    red: '#ff7b72',
    green: '#56d364',
    yellow: '#e3b341',
    blue: '#79c0ff',
    magenta: '#d2a8ff',
    cyan: '#43e6c2',
    white: '#d7e4df',
    brightBlack: '#6e7f79',
    brightRed: '#ffa198',
    brightGreen: '#7ee787',
    brightYellow: '#f2cc60',
    brightBlue: '#a5d6ff',
    brightMagenta: '#e2c5ff',
    brightCyan: '#76ead4',
    brightWhite: '#ffffff',
  },
});
const fit = new FitAddon();

terminal.loadAddon(fit);
terminal.open(container);
fit.fit();

const shell =
  process.platform === 'win32'
    ? (process.env.COMSPEC ?? 'powershell.exe')
    : (process.env.SHELL ?? '/bin/sh');
const pty = spawn(shell, [], {
  name: 'xterm-256color',
  cols: terminal.cols,
  rows: terminal.rows,
  cwd: process.env.HOME ?? process.cwd(),
  env: process.env,
});

status.textContent = `${shell} · pid ${pty.pid}`;

const input = terminal.onData((data) => pty.write(data));
const output = pty.onData((data) => terminal.write(data));
const exit = pty.onExit(({ exitCode, signal }) => {
  status.textContent = `Exited · ${exitCode}${signal ? ` · signal ${signal}` : ''}`;
  terminal.writeln(`\r\n\x1b[90mProcess exited with code ${exitCode}.\x1b[0m`);
  input.dispose();
  output.dispose();
  exit.dispose();
});

let previous = `${terminal.cols}:${terminal.rows}`;
const resize = new ResizeObserver(() => {
  fit.fit();
  const dimensions = `${terminal.cols}:${terminal.rows}`;
  if (dimensions !== previous) {
    previous = dimensions;
    pty.resize(terminal.cols, terminal.rows);
  }
});

resize.observe(container);
terminal.focus();

window.addEventListener('pagehide', () => {
  resize.disconnect();
  input.dispose();
  output.dispose();
  exit.dispose();
  pty.kill();
});
