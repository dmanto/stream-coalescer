import {app} from '../lib/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('endMaxTimeMs forces an error if the resource never reaches a terminal state', async t => {
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
