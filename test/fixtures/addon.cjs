class Counter {
  constructor(value) {
    this.value = value;
  }
  add(amount) {
    this.value += amount;
    return this.value;
  }
  get doubled() {
    return this.value * 2;
  }
  set doubled(value) {
    this.value = value / 2;
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
  mutate(bytes) {
    for (let index = 0; index < bytes.length; index++) bytes[index] ^= 0xff;
    return bytes.length;
  },
  throwValue() {
    throw 17;
  },
};
