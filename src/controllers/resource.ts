import type {MojoContext} from '@mojojs/core';
import type {Frame} from '../models/stream-resources.js';

export default class ResourceController {
  async connect(ctx: MojoContext): Promise<void> {
    const key = String(ctx.stash.key);
    const resources = ctx.models.streamResources;
    const resource = resources.getOrCreate(key);

    ctx.json(async ws => {
      const order = ++resource.order; // permanent id for this connection, never reused
      resource.count++; // live attendance — teardown trigger only

      let left = false;
      const leave = (errorFrame?: Frame): void => {
        if (left) return; // idempotent — can be triggered from two places below
        left = true;
        resource.emitter.removeListener('frame', listener); // before broadcasting, so we don't send to ourselves
        if (errorFrame !== undefined) resources.terminate(resource, errorFrame);
        // a successful end still within its TTL window stays cached for piggybacking clients;
        // an error, or a resource whose TTL grace was already spent, is torn down right away
        if (--resource.count === 0 && (resource.endedWithError !== false || resource.expired)) {
          resources.destroy(key, resource);
        }
      };

      const listener = (frame: Frame): void => {
        ws.send(frame);
        if (frame.end === true || frame.error !== undefined) {
          leave();
          ws.close(1000); // every attached connection closes once it sees the terminal frame
        }
      };
      resource.emitter.on('frame', listener);
      await ws.send({order, data: resource.data});

      let timedOut = false;
      const connectionTimer = setTimeout(() => {
        timedOut = true;
        ws.close(1000);
      }, resources.connectionMaxDurationMs).unref();

      let terminated = false;
      let wroteData = false;
      try {
        for await (const msg of ws) {
          const frame = msg as Frame;
          if (frame.end === true || frame.error !== undefined) {
            terminated = true;
            resources.terminate(resource, frame); // broadcast the terminal frame itself
            break;
          }
          resource.data.push(msg); // bound this before production use
          wroteData = true;
          resource.emitter.emit('frame', {data: [msg]});
        }
      } finally {
        clearTimeout(connectionTimer);
        // the socket dropped without an end/error — if this connection was producing
        // data, remaining listeners need to know the stream died, not just go quiet
        leave(
          !terminated && wroteData
            ? {
                error: timedOut
                  ? {code: 'CONNECTION_TIMEOUT', msg: 'connection exceeded its maximum allowed duration'}
                  : {code: 'WRITER_GONE', msg: 'connection closed without ending the stream'}
              }
            : undefined
        );
      }
    });
  }
}
