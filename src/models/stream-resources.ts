import {EventEmitter} from 'node:events';

interface Resource {
  emitter: EventEmitter;
  data: unknown[];
  order: number;
  count: number;
}

export default class StreamResources {
  #resources = new Map<string, Resource>();

  getOrCreate(key: string): Resource {
    let resource = this.#resources.get(key);
    if (resource === undefined) {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(1000);
      resource = {emitter, data: [], order: 0, count: 0};
      this.#resources.set(key, resource);
    }
    return resource;
  }

  destroy(key: string): void {
    this.#resources.delete(key); // synchronous — no await between check and delete
  }
}

declare module '@mojojs/core' {
  interface MojoModels {
    streamResources: StreamResources;
  }
}
