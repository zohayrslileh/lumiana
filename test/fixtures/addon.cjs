class Counter {
  constructor(value) {
    this.value = value;
  }
  add(amount) {
    this.value += amount;
    return this.value;
  }
}

module.exports = {
  Counter,
  call(value, callback) {
    return callback(value);
  },
  later(value, callback) {
    return new Promise((resolve) => setImmediate(() => resolve(callback(value))));
  },
  record() {
    return { local: true, values: [1, 2, 3] };
  },
  throwValue() {
    throw 17;
  },
};
