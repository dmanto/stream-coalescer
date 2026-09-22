import {app} from '../lib/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('two clients coalesce on one resource', async t => {
  const writer = await app.newTestUserAgent();
  const reader = await app.newTestUserAgent();
  t.after(async () => {
    await writer.stop();
    await reader.stop();
  });

  await writer.websocketOk('/v0/thing', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  await reader.websocketOk('/v0/thing', {json: true});
  assert.deepEqual(await reader.messageOk(), {order: 2, data: []});

  await writer.sendOk({chunk: 'hello'});
  assert.deepEqual(await reader.messageOk(), {data: [{chunk: 'hello'}]});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'hello'}]}); // writer sees its own echo too

  await writer.sendOk({end: true});
  assert.deepEqual(await reader.messageOk(), {end: true});
  assert.deepEqual(await writer.messageOk(), {end: true});

  await reader.closedOk(1000);
  await writer.closedOk(1000);

  // resource was destroyed once the last connection left — a fresh connection gets order 1 again
  const late = await app.newTestUserAgent();
  t.after(() => late.stop());
  await late.websocketOk('/v0/thing', {json: true});
  assert.deepEqual(await late.messageOk(), {order: 1, data: []});
  await late.closeOk(1000, '');
});
