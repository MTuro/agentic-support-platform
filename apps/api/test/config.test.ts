import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {configFromEnv} from '../src/config';

test('configuration rejects missing/weak/duplicate credentials, remote agents and unbounded timeouts', () => {
  const original = {...process.env};
  const token = randomBytes(32).toString('hex');
  const identity = {id: 'demo-alice', role: 'customer', token: randomBytes(32).toString('hex')};
  const valid = {DATABASE_URL: 'postgresql://localhost/example', AGENT_SERVICE_TOKEN: token,
    DEMO_IDENTITIES: JSON.stringify([identity]), AGENT_URL: 'http://127.0.0.1:8001', AGENT_TIMEOUT_MS: '90000'};
  try {
    Object.assign(process.env, valid);
    assert.equal(configFromEnv().identities[0]?.id, identity.id);
    for (const change of [
      {AGENT_SERVICE_TOKEN: ''}, {DATABASE_URL: ''}, {DEMO_IDENTITIES: '[]'},
      {DEMO_IDENTITIES: JSON.stringify([identity, identity])},
      {DEMO_IDENTITIES: JSON.stringify([{...identity, token}])},
      {DEMO_IDENTITIES: JSON.stringify([{...identity, role: 'admin'}])},
      {AGENT_URL: 'http://example.org'}, {AGENT_URL: 'http://user:pass@localhost:8001'},
      {AGENT_URL: 'http://127.0.0.1:8001/path'}, {AGENT_TIMEOUT_MS: '0'}, {AGENT_TIMEOUT_MS: 'Infinity'}
    ]) {
      Object.assign(process.env, valid, change);
      assert.throws(configFromEnv);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
