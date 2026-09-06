import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';

export class Interface extends EventEmitter {
  readonly input: any;
  readonly output: any;
  terminal: boolean;
  line = '';
  cursor = 0;
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private closed = false;

  constructor(input: any, output?: any, _completer?: any, terminal?: boolean) {
    super();
    const options = input && typeof input === 'object' && 'input' in input ? input : undefined;
    this.input = options?.input ?? input;
    this.output = options?.output ?? output;
    this.terminal = options?.terminal ?? terminal ?? Boolean(this.output?.isTTY);
    this.input?.on?.('data', this.onData);
    this.input?.once?.('end', this.onEnd);
    this.input?.once?.('error', this.onError);
  }

  private onData = (chunk: any) => {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const lines = this.buffer.split(/\r?\n|\r(?!\n)/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.emit('line', line);
  };

  private onEnd = () => {
    this.buffer += this.decoder.end();
    if (this.buffer) this.emit('line', this.buffer);
    this.buffer = '';
    this.close();
  };

  private onError = (error: Error) => this.emit('error', error);

  setPrompt(prompt: string): void {
    (this as any)._prompt = String(prompt);
  }

  prompt(): void {
    this.output?.write?.((this as any)._prompt ?? '> ');
  }

  question(query: string, options: any, done?: (answer: string) => void): void {
    if (typeof options === 'function') [done, options] = [options, undefined];
    if (typeof done !== 'function') throw new TypeError('The callback argument must be a function');
    this.output?.write?.(query);
    this.once('line', done);
  }

  pause(): this {
    this.input?.pause?.();
    this.emit('pause');
    return this;
  }

  resume(): this {
    this.input?.resume?.();
    this.emit('resume');
    return this;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.input?.off?.('data', this.onData);
    this.input?.off?.('end', this.onEnd);
    this.input?.off?.('error', this.onError);
    this.emit('close');
  }

  write(data: any): void {
    this.onData(data);
  }
}

export const ReadLine = Interface;
export const createInterface = (...args: any[]): Interface => new (Interface as any)(...args);
export const emitKeypressEvents = (_stream: any, _iface?: Interface): void => {};
export const clearLine = (stream: any, dir: number, callback?: () => void) =>
  stream.write?.(`\u001b[${dir < 0 ? '1K' : dir > 0 ? '0K' : '2K'}`, callback);
export const clearScreenDown = (stream: any, callback?: () => void) =>
  stream.write?.('\u001b[0J', callback);
export const cursorTo = (stream: any, x: number, y?: number, callback?: () => void) =>
  stream.write?.(`\u001b[${y === undefined ? '' : `${y + 1};`}${x + 1}H`, callback);
export const moveCursor = (stream: any, dx: number, dy: number, callback?: () => void) => {
  let sequence = '';
  if (dx) sequence += `\u001b[${Math.abs(dx)}${dx < 0 ? 'D' : 'C'}`;
  if (dy) sequence += `\u001b[${Math.abs(dy)}${dy < 0 ? 'A' : 'B'}`;
  return stream.write?.(sequence, callback);
};

export class PromiseInterface extends Interface {
  question(query: string, options?: any): Promise<string> {
    return new Promise((resolve) => super.question(query, options, resolve));
  }
}

export const promises = {
  Interface: PromiseInterface,
  createInterface(...args: any[]) {
    return new (this.Interface as any)(...args);
  },
};

export default {
  Interface,
  ReadLine,
  clearLine,
  clearScreenDown,
  createInterface,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
  promises,
};
