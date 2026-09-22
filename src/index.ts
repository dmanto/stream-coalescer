#!/usr/bin/env node
import mojo from '@mojojs/core';
import StreamResources from './models/stream-resources.js';

export const app: ReturnType<typeof mojo> = mojo();

app.models.streamResources = new StreamResources();

app.websocket('/v0/:key').to('resource#connect').name('connect_resource');

app.start();
