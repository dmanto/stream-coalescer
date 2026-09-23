import {app} from '../lib/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('connectionMaxDurationMs on a producing connection reports CONNECTION_TIMEOUT, not WRITER_GONE', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const resources = app.models.streamResources;
  const savedEndMaxTimeMs = resources.endMaxTimeMs;
  const savedConnectionMaxDurationMs = resources.connectionMaxDurationMs;
  t.after(() => {
    resources.endMaxTimeMs = savedEndMaxTimeMs;
    resources.connectionMaxDurationMs = savedConnectionMaxDurationMs;
  });

  // keep endMaxTimeMs from winning the race against the writer's own short budget
  resources.endMaxTimeMs = 1_000_000;

  const writer = await app.newTestUserAgent();
  const reader = await app.newTestUserAgent();
  t.after(async () => {
    await writer.stop();
    await reader.stop();
  });

  // the writer gets the short budget — it's the one meant to time out here
  resources.connectionMaxDurationMs = 5_000;
  await writer.websocketOk('/v0/writer-timeout', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  // the reader gets a huge budget so only the writer's own timer fires
  resources.connectionMaxDurationMs = 1_000_000;
  await reader.websocketOk('/v0/writer-timeout', {json: true});
  assert.deepEqual(await reader.messageOk(), {order: 2, data: []});

  await writer.sendOk({chunk: 'hello'});
  assert.deepEqual(await reader.messageOk(), {data: [{chunk: 'hello'}]});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'hello'}]});

  // writer never ends — its own (short) connectionMaxDurationMs elapses. The writer's own
  // listener is removed before the synthesized error is broadcast (same as WRITER_GONE), so
  // only the reader — the bystander still registered — ever sees the CONNECTION_TIMEOUT frame.
  t.mock.timers.tick(5_000);
  t.mock.timers.reset(); // the forced error still needs a real close handshake to complete

  assert.deepEqual(await reader.messageOk(), {
    error: {code: 'CONNECTION_TIMEOUT', msg: 'connection exceeded its maximum allowed duration'}
  });
  await reader.closedOk(1000);
  await writer.closedOk(1000);
});
