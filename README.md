# stream-coalescer

An in-flight coalescing cache for **streamed** responses. Point several concurrent requests at the same resource and only the first one actually does the work — everyone else piggybacks on it live, catches up on what already streamed, and gets told when it's done.

## The gap this fills

Request coalescing (a.k.a. singleflight, collapsed forwarding, dogpile prevention) is a solved problem — for atomic responses. Varnish does it by default. nginx has `proxy_cache_lock`. Go has `singleflight`. And pub/sub brokers (Centrifugo, Mercure, Pushpin) solve fan-out with catch-up for already-decided, already-published data.

Neither covers this shape: a client connects, doesn't know if anyone else is already fetching the same thing, and needs to either become the producer or transparently join one already in flight — receiving everything already streamed *plus* the live tail, over one connection, in one protocol. That's what this is.

## How it works

Connect to `ws(s)://<service>/v0/<resource-key>`. The **first** connection for a given key becomes the writer by construction — there's no role negotiation, no election, just event-loop ordering. Anyone connected can send data; it gets broadcast to every attached connection (including the sender) and buffered for whoever joins later.

```
ws1 -> connect /v0/report-42        ws1 <- {"order":1,"data":[]}
ws1 -> {"chunk":"row 1"}            ws1 <- {"data":[{"chunk":"row 1"}]}
                                     ws2 -> connect /v0/report-42
                                     ws2 <- {"order":2,"data":[{"chunk":"row 1"}]}
ws1 -> {"chunk":"row 2"}            ws1 <- {"data":[{"chunk":"row 2"}]}
                                     ws2 <- {"data":[{"chunk":"row 2"}]}
ws1 -> {"end":true}                 ws1 <- {"end":true}  (closes)
                                     ws2 <- {"end":true}  (closes)

ws3 -> connect /v0/report-42        ws3 <- {"order":3,"data":[{"chunk":"row 1"},{"chunk":"row 2"}],"end":true}  (closes)
```

`ws3` joined after the flight already finished — a successful result stays cached for late piggybackers (see `maxAgeMs` below), so it gets the full catch-up plus the terminal status in one shot instead of triggering a new fetch.

### Protocol

Every message is JSON. The connection's first inbound message is the opening frame:

| Field | Type | Meaning |
|---|---|---|
| `order` | `number` | This connection's permanent, never-reused rank for this resource. `1` means you were first. |
| `data` | `array` | Everything already streamed, in order — empty on a fresh resource. |
| `end` | `boolean?` | Present and `true` only if the resource already finished successfully. |
| `error` | `{code, msg}?` | Present only if the resource already failed. |

After that, any connection may send data — it gets echoed to every attached connection as `{"data": [...]}`. Sending `{"end": true}` or `{"error": {"code", "msg"}}` ends the resource for everyone: every connection gets that exact frame and closes with code `1000`.

**Synthesized errors** — the resource can fail on its own, not just on request:

- `WRITER_GONE` — a connection that had sent data disconnected without an `end`/`error`.
- `CONNECTION_TIMEOUT` — same, but caused by hitting `connectionMaxDurationMs` rather than a raw drop.
- `END_TIMEOUT` — the resource never reached a terminal state within `endMaxTimeMs`.

A resource that ends in **error never lingers** — it's torn down immediately so the next request gets a clean retry, not a cached failure.

## Quickstart

```sh
pnpm add stream-coalescer
pnpm exec stream-coalescer server -l 'http://*:0'
# Web application available at http://0.0.0.0:54321/
```

Port `0` picks a random free port and prints the real URL — handy for spawning it from a test harness in any language, not just Node: read the URL off stdout, talk WebSocket/HTTP to it, tear it down when done. Unix domain sockets work too: `-l 'http+unix:///tmp/stream-coalescer.sock'`.

No language lock-in on the client side — it's plain WebSocket framing over HTTP. If your stack can open a WebSocket, it can use this.

## Configuration

Three timers, each with a sane default, overridable via `config.json` in the working directory (no CLI flag needed — just drop the file):

```json
{
  "maxAgeMs": 20000,
  "endMaxTimeMs": 30000,
  "connectionMaxDurationMs": 60000
}
```

- **`maxAgeMs`** — how long a *successfully completed* resource stays cached for piggybackers after the last connection leaves. Anchored at resource creation, not renewed by traffic. An errored resource ignores this entirely and is destroyed right away.
- **`endMaxTimeMs`** — the resource-wide ceiling on how long a stream may stay unfinished before it's force-errored (`END_TIMEOUT`) for everyone attached.
- **`connectionMaxDurationMs`** — a per-connection ceiling; only that one connection gets closed if it's exceeded, not the whole resource.

## A concrete use case: coalescing LLM completions

Point several identical concurrent chat/completion requests at one resource key (e.g. a hash of the prompt): only the first caller actually hits the model API and pays for the tokens; every other caller streams the same tokens live, for free, from the one in-flight call. ([Cradle](https://github.com/519lab/cradle) does this same trick baked into an LLM-specific gateway — this generalizes it to any streamed resource, as a standalone service any language can talk to.)

## Development

```sh
pnpm install
pnpm test     # builds, then runs node:test with coverage
pnpm lint
pnpm run dev  # --watch, port 3000
```

Node >= 22, pnpm. See `CHANGELOG.md` for release notes.

## Security note

There's no auth on the wire protocol — any connection can write. This is meant to run as an internal microservice on a trusted network (e.g. behind a web server that's the only thing talking to it), not exposed directly to untrusted clients.

## License

MIT
