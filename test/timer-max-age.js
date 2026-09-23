import {app} from '../lib/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';

// its own file, its own process — keeps this test's three agents (more lingering
// sockets/servers than any other test) from interacting with another test's mock timers
test('a successfully completed resource stays cached until maxAgeMs elapses', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const resources = app.models.streamResources;

  const writer = await app.newTestUserAgent();
  t.after(() => writer.stop());

  await writer.websocketOk('/v0/ttl', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  await writer.sendOk({chunk: 'hello'});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'hello'}]});

  await writer.sendOk({end: true});
  assert.deepEqual(await writer.messageOk(), {end: true});
  await writer.closedOk(1000);

  // count is 0, but the flight ended successfully — a new connection still finds it cached,
  // and since it's already terminal, gets the full catch-up plus that status in one shot
  const reader = await app.newTestUserAgent();
  t.after(() => reader.stop());
  await reader.websocketOk('/v0/ttl', {json: true});
  assert.deepEqual(await reader.messageOk(), {order: 2, data: [{chunk: 'hello'}], end: true});
  await reader.closedOk(1000);

  // advance past maxAgeMs with nobody attached — the resource must really be gone now
  t.mock.timers.tick(resources.maxAgeMs);

  const late = await app.newTestUserAgent();
  t.after(() => late.stop());
  await late.websocketOk('/v0/ttl', {json: true});
  assert.deepEqual(await late.messageOk(), {order: 1, data: []});
  await late.closeOk(1000, '');
});
