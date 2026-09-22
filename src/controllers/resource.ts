import type {MojoContext} from '@mojojs/core';

interface Frame {
  data?: unknown[];
  end?: boolean;
  error?: {code: string; msg: string};
}

export default class ResourceController {
  async connect(ctx: MojoContext): Promise<void> {
    const key = String(ctx.stash.key);
    const resource = ctx.models.streamResources.getOrCreate(key);

    ctx.json(async ws => {
      const order = ++resource.order; // permanent id for this connection, never reused
      resource.count++; // live attendance — teardown trigger only

      let left = false;
      const leave = (): void => {
        if (left) return; // idempotent — can be triggered from two places below
        left = true;
        resource.emitter.removeListener('frame', listener);
        if (--resource.count === 0) ctx.models.streamResources.destroy(key);
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

      try {
        for await (const msg of ws) {
          const frame = msg as Frame;
          if (frame.end === true || frame.error !== undefined) {
            resource.emitter.emit('frame', frame); // broadcast the terminal frame itself
            break;
          }
          resource.data.push(msg); // bound this before production use
          resource.emitter.emit('frame', {data: [msg]});
        }
      } finally {
        leave(); // covers the socket just dropping, with no end/error ever sent
      }
    });
  }
}
