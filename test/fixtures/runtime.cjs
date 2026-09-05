const { EventEmitter } = require('node:events');
const { threadId } = require('node:worker_threads');
let count = 0;
class Counter {
  constructor(value = 0) {
    this.value = value;
  }
  add(n) {
    this.value += n;
    return this;
  }
}
exports.Counter = Counter;
exports.readTree = () =>
  new (class {
    child = new (class {
      value = 42;
    })();
  })();
exports.identity = () => ({ threadId, count: ++count });
exports.create = () => {
  const emitter = new EventEmitter();
  process.nextTick(() => emitter.emit('ready', 42));
  return emitter;
};
exports.callback = (fn) => fn(41) + 1;
exports.sort = (fn) => [3, 1, 2].sort(fn);
exports.echo = (value) => value;
exports.promise = () => Promise.resolve(42);
exports.error = () => {
  const error = new TypeError('native failure');
  error.code = 'E_NATIVE';
  throw error;
};
exports.values = () => ({
  array: [1, 2, 3],
  map: new Map([['a', 1]]),
  date: new Date(0),
  symbol: Symbol('native'),
  big: 2n ** 80n,
});
exports.log = () => console.log('native log', 42);
exports.forever = () => new Promise(() => {});
exports.exit = () => setTimeout(() => process.exit(0), 20);

exports.throwValue = (value) => {
  throw value;
};
exports.stdout = () => process.stdout.write('native stdout\n');
