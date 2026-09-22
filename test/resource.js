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

  // the flight ended successfully, so it stays cached — a late joiner piggybacks on it
  // instead of getting a fresh resource (full expiry-after-maxAgeMs is covered separately)
  const late = await app.newTestUserAgent();
  t.after(() => late.stop());
  await late.websocketOk('/v0/thing', {json: true});
  assert.deepEqual(await late.messageOk(), {order: 3, data: [{chunk: 'hello'}], end: true});
  await late.closedOk(1000);
});

test('a piggybacking client catches up on data sent before it joined', async t => {
  const writer = await app.newTestUserAgent();
  t.after(() => writer.stop());

  await writer.websocketOk('/v0/piggyback', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  await writer.sendOk({chunk: 'one'});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'one'}]}); // writer's own echo

  await writer.sendOk({chunk: 'two'});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'two'}]});

  // joins after two chunks already streamed — must catch up on both in one shot
  const reader = await app.newTestUserAgent();
  t.after(() => reader.stop());
  await reader.websocketOk('/v0/piggyback', {json: true});
  assert.deepEqual(await reader.messageOk(), {order: 2, data: [{chunk: 'one'}, {chunk: 'two'}]});

  // and still gets live chunks sent after it joined, same as an original listener would
  await writer.sendOk({chunk: 'three'});
  assert.deepEqual(await reader.messageOk(), {data: [{chunk: 'three'}]});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'three'}]});

  // a third, even later joiner catches up on the full accumulated history
  const latest = await app.newTestUserAgent();
  t.after(() => latest.stop());
  await latest.websocketOk('/v0/piggyback', {json: true});
  assert.deepEqual(await latest.messageOk(), {
    order: 3,
    data: [{chunk: 'one'}, {chunk: 'two'}, {chunk: 'three'}]
  });

  await writer.sendOk({end: true});
  assert.deepEqual(await reader.messageOk(), {end: true});
  assert.deepEqual(await writer.messageOk(), {end: true});
  assert.deepEqual(await latest.messageOk(), {end: true});

  await reader.closedOk(1000);
  await writer.closedOk(1000);
  await latest.closedOk(1000);
});

test('a client-sent error message ends the stream for everyone', async t => {
  const writer = await app.newTestUserAgent();
  const reader = await app.newTestUserAgent();
  t.after(async () => {
    await writer.stop();
    await reader.stop();
  });

  await writer.websocketOk('/v0/broken', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  await reader.websocketOk('/v0/broken', {json: true});
  assert.deepEqual(await reader.messageOk(), {order: 2, data: []});

  await writer.sendOk({error: {code: 'UPSTREAM_FAILED', msg: 'boom'}});
  assert.deepEqual(await reader.messageOk(), {error: {code: 'UPSTREAM_FAILED', msg: 'boom'}});
  assert.deepEqual(await writer.messageOk(), {error: {code: 'UPSTREAM_FAILED', msg: 'boom'}}); // writer sees its own echo too

  await reader.closedOk(1000);
  await writer.closedOk(1000);

  const late = await app.newTestUserAgent();
  t.after(() => late.stop());
  await late.websocketOk('/v0/broken', {json: true});
  assert.deepEqual(await late.messageOk(), {order: 1, data: []});
  await late.closeOk(1000, '');
});

test('a dropped connection synthesizes a WRITER_GONE error for remaining listeners', async t => {
  const writer = await app.newTestUserAgent();
  const reader = await app.newTestUserAgent();
  t.after(async () => {
    await writer.stop();
    await reader.stop();
  });

  await writer.websocketOk('/v0/dropped', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  await reader.websocketOk('/v0/dropped', {json: true});
  assert.deepEqual(await reader.messageOk(), {order: 2, data: []});

  await writer.sendOk({chunk: 'hello'});
  assert.deepEqual(await reader.messageOk(), {data: [{chunk: 'hello'}]});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'hello'}]});

  // writer disconnects without ever sending end/error
  await writer.closeOk(1000, '');

  assert.deepEqual(await reader.messageOk(), {
    error: {code: 'WRITER_GONE', msg: 'connection closed without ending the stream'}
  });
  await reader.closedOk(1000);

  const late = await app.newTestUserAgent();
  t.after(() => late.stop());
  await late.websocketOk('/v0/dropped', {json: true});
  assert.deepEqual(await late.messageOk(), {order: 1, data: []});
  await late.closeOk(1000, '');
});

test('a successfully completed resource stays cached until maxAgeMs elapses', async t => {
  // real settling time for sockets/servers left closing by earlier tests — mixing that
  // teardown with mocked setTimeout otherwise turns a fast close into a ~30s real wait
  await new Promise(r => setTimeout(r, 100));
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
  t.mock.timers.reset(); // back to real timers — nothing left to fire, just being tidy

  const late = await app.newTestUserAgent();
  t.after(() => late.stop());
  await late.websocketOk('/v0/ttl', {json: true});
  assert.deepEqual(await late.messageOk(), {order: 1, data: []});
  await late.closeOk(1000, '');
});

test('endMaxTimeMs forces an error if the resource never reaches a terminal state', async t => {
  await new Promise(r => setTimeout(r, 100)); // see the previous test's comment
  t.mock.timers.enable({apis: ['setTimeout']});
  const resources = app.models.streamResources;

  const writer = await app.newTestUserAgent();
  t.after(() => writer.stop());

  await writer.websocketOk('/v0/end-timeout', {json: true});
  assert.deepEqual(await writer.messageOk(), {order: 1, data: []});

  await writer.sendOk({chunk: 'still going'});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'still going'}]});

  // never sends end/error — advance past endMaxTimeMs
  t.mock.timers.tick(resources.endMaxTimeMs);
  t.mock.timers.reset(); // the forced error still needs a real close handshake to complete

  assert.deepEqual(await writer.messageOk(), {
    error: {code: 'END_TIMEOUT', msg: 'resource did not reach a terminal state in time'}
  });
  await writer.closedOk(1000);
});

test('connectionMaxDurationMs closes an idle reader without affecting the resource', async t => {
  await new Promise(r => setTimeout(r, 100)); // see the TTL test's comment above
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
  t.mock.timers.reset(); // the forced close still needs a real close handshake to complete
  await reader.closedOk(1000);

  // the resource itself is untouched — the writer keeps going normally
  await writer.sendOk({chunk: 'still alive'});
  assert.deepEqual(await writer.messageOk(), {data: [{chunk: 'still alive'}]});

  await writer.sendOk({end: true});
  assert.deepEqual(await writer.messageOk(), {end: true});
  await writer.closedOk(1000);
});

test('connectionMaxDurationMs on a producing connection reports CONNECTION_TIMEOUT, not WRITER_GONE', async t => {
  await new Promise(r => setTimeout(r, 100)); // see the TTL test's comment above
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
