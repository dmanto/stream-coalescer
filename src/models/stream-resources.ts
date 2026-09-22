import {EventEmitter} from 'node:events';

export interface Frame {
  data?: unknown[];
  end?: boolean;
  error?: {code: string; msg: string};
}

export interface Resource {
  emitter: EventEmitter;
  data: unknown[];
  order: number;
  count: number;
  expired: boolean; // TTL window already fired once while attended — next zero destroys, no more grace
  endedWithError: boolean | undefined; // undefined = not terminated yet
}

export interface StreamResourcesOptions {
  maxAgeMs?: number; // how long a resource stays cached after count reaches 0, if it ended successfully
  endMaxTimeMs?: number; // how long a resource may stay non-terminal before a timeout error is forced
  connectionMaxDurationMs?: number; // how long a single connection may stay open before it's force-closed
}

const DEFAULT_MAX_AGE_MS = 20_000;
const DEFAULT_END_MAX_TIME_MS = 30_000;
const DEFAULT_CONNECTION_MAX_DURATION_MS = 60_000;

export default class StreamResources {
  #resources = new Map<string, Resource>();
  maxAgeMs: number;
  endMaxTimeMs: number;
  connectionMaxDurationMs: number;

  constructor(options: StreamResourcesOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.endMaxTimeMs = options.endMaxTimeMs ?? DEFAULT_END_MAX_TIME_MS;
    this.connectionMaxDurationMs = options.connectionMaxDurationMs ?? DEFAULT_CONNECTION_MAX_DURATION_MS;
  }

  getOrCreate(key: string): Resource {
    const existing = this.#resources.get(key);
    if (existing !== undefined) return existing;

    const emitter = new EventEmitter();
    emitter.setMaxListeners(1000);
    const resource: Resource = {emitter, data: [], order: 0, count: 0, expired: false, endedWithError: undefined};
    this.#resources.set(key, resource);

    // anchored at creation, not renewed by activity — caps how long a cached, completed
    // resource may keep serving piggybacking clients before it's really torn down
    setTimeout(() => {
      if (resource.count === 0) this.destroy(key, resource);
      else resource.expired = true;
    }, this.maxAgeMs).unref();

    // anchored at creation — caps how long the resource may stay non-terminal at all
    setTimeout(() => {
      if (resource.endedWithError === undefined) {
        this.terminate(resource, {
          error: {code: 'END_TIMEOUT', msg: 'resource did not reach a terminal state in time'}
        });
      }
    }, this.endMaxTimeMs).unref();

    return resource;
  }

  /** Records how the resource ended and broadcasts the terminal frame to every attached connection. */
  terminate(resource: Resource, frame: Frame): void {
    resource.endedWithError = frame.error !== undefined;
    resource.emitter.emit('frame', frame);
  }

  /** No-ops if `key` no longer points at this exact resource — a newer generation may already be there. */
  destroy(key: string, resource: Resource): void {
    if (this.#resources.get(key) === resource) this.#resources.delete(key);
  }
}

declare module '@mojojs/core' {
  interface MojoModels {
    streamResources: StreamResources;
  }
}
