import {app} from '../lib/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('connectionMaxDurationMs closes an idle reader without affecting the resource', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const resources = app.models.streamResources;
  const saved = resources.connectionMaxDurationMs;
  t.after(() => {
    resources.connectionMaxDurationMs = saved;
  });

  const writer = await app.newTestUserAgent();
  const reader = await app.newTestUserAgent();
  t.after(async () => {
    await writer.stop();
    await reader.stop();
  });

  // connectionMaxDurationMs isn't a sliding window — it's read once, per connection, at the
  // moment each one connects. Give the writer a huge budget so its own timer can't possibly
  // fire in this test, then shrink it before the reader connects so only the reader's fires.
  resources.connectionMaxDurationMs = 1_000_000;
  await writer.websocketOk('/v0/reader-timeout', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  resources.connectionMaxDurationMs = 5_000;
  await reader.websocketOk('/v0/reader-timeout', {json: true});
  assert.deepEqual(await reader.messageOk(), {order: 2, data: []});

  // the reader just sits there, never writing anything — only its own connection times out
  t.mock.timers.tick(5_000);
  await reader.closedOk(1000);

  // the resource itself is untouched — the writer keeps going normally
  await writer.sendOk({chunk: 'still alive'});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'still alive'}]});

  await writer.sendOk({end: true});
  assert.deepEqual(await writer.messageOk(), {end: true});
  await writer.closedOk(1000);
});
