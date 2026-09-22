# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-09-22

### Added

- Initial release: single-writer, in-flight coalescing WebSocket relay per resource (`/v0/:key`).
- First connection to write becomes the stream's writer by construction; later connections piggyback and catch up via the buffered `data` array.
- `end`/`error` terminal frames close every attached connection; a `WRITER_GONE` error is synthesized if the writer disconnects without sending one.
- `stream-coalescer` CLI entry point (`pnpm exec stream-coalescer server -l ...`).
- Cross-platform build scripts and CI (macOS, Windows, Linux).
