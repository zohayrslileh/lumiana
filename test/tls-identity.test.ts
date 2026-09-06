import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { checkServerIdentity } from '../src/runtime/tls-identity.js';
import { Agent } from '../src/runtime/https.js';

test('browser hostname matching agrees with native certificate name checks', () => {
  const certificates = [
    {},
    { subject: { CN: ['fallback.example', 'localhost'] } },
    { subject: { CN: 'localhost' }, subjectaltname: 'DNS:other.example' },
    { subjectaltname: 'DNS:localhost, IP Address:127.0.0.1' },
    { subjectaltname: 'DNS:*.example.com, DNS:xn--bcher-kva.example' },
    { subjectaltname: 'DNS:a*b.example.com' },
    { subjectaltname: 'DNS:*.com, DNS:*.xn--bcher-kva.example' },
    { subjectaltname: 'DNS:"a,b.example", DNS:localhost' },
    { subjectaltname: 'DNS:"broken' },
  ];
  for (const certificate of certificates) {
    for (const hostname of [
      'localhost',
      'LOCALHOST.',
      '127.0.0.1',
      '127.0.0.2',
      'fallback.example',
      'a.example.com',
      'a.b.example.com',
      'ab.example.com',
      'bücher.example',
      'a,b.example',
      'example.com',
    ]) {
      const outcome = (check: Function) => {
        try {
          const error = check(hostname, certificate);
          return error ? { code: error.code, reason: error.reason } : undefined;
        } catch (error: any) {
          return { thrown: error.code };
        }
      };
      assert.deepEqual(
        outcome(checkServerIdentity),
        outcome(tls.checkServerIdentity),
        `${hostname}: ${JSON.stringify(certificate)}`,
      );
    }
  }
});

test('browser hostname matching canonicalizes IPv6 and retains the original certificate', () => {
  const certificate = { subjectaltname: 'IP Address:0:0:0:0:0:0:0:1' };
  assert.equal(checkServerIdentity('::1', certificate), undefined);
  const error = checkServerIdentity('::2', certificate) as any;
  assert.equal(error.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  assert.equal(error.cert, certificate);
});

test('HTTPS pooling distinguishes context and validation identities without engine calls', () => {
  const agent = new Agent({ keepAlive: true });
  const options = { host: 'localhost', port: 443, secureContext: {}, checkServerIdentity() {} };
  assert.equal(agent.getName(options), agent.getName({ ...options }));
  assert.notEqual(agent.getName(options), agent.getName({ ...options, secureContext: {} }));
  assert.notEqual(agent.getName(options), agent.getName({ ...options, checkServerIdentity() {} }));
  assert.equal(
    agent.getName({ ca: Buffer.from('certificate') }),
    agent.getName({ ca: Buffer.from('certificate') }),
  );
});
