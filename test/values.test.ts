import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { encodeValue, decodeValue } from '../src/values.js';

test('boundary values copy without creating remote JavaScript references', () => {
  const source: any = {
    array: [1, 2, 3],
    binary: Buffer.from([0, 128, 255]),
    date: new Date(1234),
    expression: /lumiana/gi,
  };
  source.self = source;
  const result = decodeValue(encodeValue(source));

  assert.notEqual(result, source);
  assert.equal(result.self, result);
  assert.deepEqual(result.array, [1, 2, 3]);
  assert.deepEqual(result.binary, source.binary);
  assert.equal(result.date.getTime(), 1234);
  assert.equal(result.expression.source, 'lumiana');
  assert.equal(result.expression.flags, 'gi');
});

test('the boundary rejects JavaScript behavior instead of moving it to the Worker', () => {
  assert.throws(() => encodeValue(() => 42), /Cannot send a function/);
  assert.throws(() => encodeValue(new Map()), /Cannot send \[object Map\]/);
  const behavioralRecord = {};
  Object.defineProperty(behavioralRecord, 'method', { value() {} });
  assert.throws(() => encodeValue(behavioralRecord), /Cannot send \[object Object\]/);
});
