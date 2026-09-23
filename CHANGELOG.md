# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-09-23

### Added

- `maxAgeMs`, `endMaxTimeMs`, and `connectionMaxDurationMs` config options (via `config.json`), each with a sane default — resource-level and per-connection timeouts.
- `END_TIMEOUT` error: forced if a resource never reaches a terminal state within `endMaxTimeMs`.
- `CONNECTION_TIMEOUT` error: a single connection is closed if it exceeds `connectionMaxDurationMs`, without affecting the rest of the resource.

### Changed

- A resource that ends successfully now stays cached for `maxAgeMs` after the last connection leaves, so late joiners piggyback on the finished result instead of triggering a fresh fetch. A resource that ends in error is still torn down immediately, so the next request gets a clean retry.
- Minimum Node.js version raised from 20 to 22.

### Fixed

- A connection joining an already-terminated resource now receives the terminal status (`end`/`error`) in its catch-up frame immediately and closes right away, instead of waiting indefinitely for a message that would never arrive.

## [0.1.0] - 2026-09-22

### Added

- Initial release: single-writer, in-flight coalescing WebSocket relay per resource (`/v0/:key`).
- First connection to write becomes the stream's writer by construction; later connections piggyback and catch up via the buffered `data` array.
- `end`/`error` terminal frames close every attached connection; a `WRITER_GONE` error is synthesized if the writer disconnects without sending one.
- `stream-coalescer` CLI entry point (`pnpm exec stream-coalescer server -l ...`).
- Cross-platform build scripts and CI (macOS, Windows, Linux).
