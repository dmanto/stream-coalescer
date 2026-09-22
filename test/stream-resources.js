import StreamResources from '../lib/models/stream-resources.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('uses hardcoded defaults when constructed without options', () => {
  const resources = new StreamResources();
  assert.equal(resources.maxAgeMs, 20_000);
  assert.equal(resources.endMaxTimeMs, 30_000);
  assert.equal(resources.connectionMaxDurationMs, 60_000);
});

test('respects explicit overrides, per option', () => {
  const resources = new StreamResources({maxAgeMs: 1_000});
  assert.equal(resources.maxAgeMs, 1_000);
  assert.equal(resources.endMaxTimeMs, 30_000);
  assert.equal(resources.connectionMaxDurationMs, 60_000);
});
