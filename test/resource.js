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
