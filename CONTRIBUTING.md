# Contributing

## Setup

See the [Development](README.md#development) section of the README for install, build, test, and lint commands.

## Before opening a PR

- `pnpm lint` and `pnpm test` both pass. CI runs both across Linux/macOS/Windows and Node 22/24, and will block on either failing.
- New behavior gets a test. This project keeps 100% line coverage; a branch coverage gap is fine only when that branch is genuinely unreachable — say so in a comment if you leave one.
- Keep the change focused. If it touches the wire protocol or a config default, call that out explicitly in the PR description.

## Commit messages

Imperative, present-tense subject line ("Add X", not "Added X" or "Adds X"). If the *why* isn't obvious from the diff, put it in the body — that's more useful than restating what changed.

## Questions or bugs

Open an issue.

## Reporting a vulnerability

This is meant to run as an internal microservice on a trusted network (see the Security note in the README), not exposed to untrusted clients. If you find something that breaks that assumption, please use GitHub's private security advisory reporting instead of a public issue.
