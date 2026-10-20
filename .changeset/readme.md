# Changesets

This folder contains **pending release notes**. Each `.md` file describes one user-facing fix or feature that should appear in the next generated changelog.

## What to put here

- Add one descriptive kebab-case `.md` file per logical change, for example `fix-chatgpt-token-save.md`.
- Use `patch` for fixes and `minor` for new features.
- Write in present tense, focused on what users see.
- Check GitHub issues first. If the change fixes one, include `Fixes #123` on its own line.

## Packages

- `egaki` for CLI and video-framework changes
- `@egaki/midjourney` when that package changes

## What not to put here

- Do not add changesets for example apps.
- Do not add changesets for `egaki-website` or `egaki-gateway`. They have no `version` field.
- Do not edit `CHANGELOG.md` directly.
- Do not run the interactive changeset CLI.
- Do not add vague entries like "misc improvements" or "update internals".
