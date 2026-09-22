#!/usr/bin/env node
import mojo, {jsonConfigPlugin} from '@mojojs/core';
import StreamResources, {type StreamResourcesOptions} from './models/stream-resources.js';

export const app: ReturnType<typeof mojo> = mojo();

app.plugin(jsonConfigPlugin); // reads config.json (or config.<mode>.json) from app.home, if present

app.models.streamResources = new StreamResources(app.config as StreamResourcesOptions);

app.websocket('/v0/:key').to('resource#connect').name('connect_resource');

app.start();
