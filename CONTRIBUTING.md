# Contributing to claudeline

Thanks for thinking about contributing. This is a small, opinionated project
and we want to keep it that way — simple, fast, and well-tested.

## Ground rules

- **Small modules.** One cohesive concept per file. If a module starts holding
  unrelated responsibilities, split it.
- **Tests first.** Every change should land with a test that fails without
  the change. We use [Bun's built-in test runner](https://bun.com/docs/cli/test).
- **Schemas as contracts.** Anything that crosses an external boundary (stdin
  JSON, the OAuth API, `settings.json`, credentials file) is validated by a
  Zod schema in [`src/schemas.ts`](./src/schemas.ts).
- **Pure where possible.** Side effects (filesystem, child processes,
  network) are isolated and injected via interfaces so the orchestrator stays
  testable without mocks.
- **No abstractions for unimplemented features.** YAGNI is enforced in code
  review.

## Local setup

You need [Bun](https://bun.com) ≥ 1.3 and Node.js ≥ 18.

```bash
git clone https://github.com/arcasilesgroup/claudeline
cd claudeline
bun install
bun test
bunx tsc --noEmit
```

## Building

```bash
# Bundled JS (cross-platform, requires Node or Bun to run)
bun build src/cli.ts \
  --target=node \
  --outfile=dist/cli.js \
  --minify \
  --banner='#!/usr/bin/env node'

# Self-contained binary for the current platform
bun build src/cli.ts --compile --outfile=dist/claudeline
```

## Testing locally

Pipe a fixture into the CLI:

```bash
echo '{"model":{"display_name":"Opus 4.7"},"effort":{"level":"max"},"cwd":"."}' \
  | bun src/cli.ts render
```

Or link the package globally and let Claude Code drive it:

```bash
bun link
claudeline install   # writes statusLine into ~/.claude/settings.json
# … restart Claude Code …
claudeline uninstall # to revert
```

## Pull request checklist

Before opening a PR:

- [ ] `bun test` passes (no `.only`, no skipped tests left behind)
- [ ] `bunx tsc --noEmit` is clean
- [ ] No new dependencies unless strictly necessary — every dependency is a
      future maintenance and security risk
- [ ] If you touched stdin parsing, the OAuth API, or `settings.json`,
      update the relevant Zod schema
- [ ] If you added user-visible behavior, update the README
- [ ] If you fixed a security-relevant issue, also update SECURITY.md and
      mention it in CHANGELOG.md

## Commit messages

Imperative mood, short subject (≤ 70 chars), reference issues by number.
Example:

```
add max effort glyph (#42)

Renders ◉ in magenta for both `max` and `xhigh` so users on the new
runtime see a distinct indicator from `high`.
```

## Reporting bugs

Use the bug template in
[`.github/ISSUE_TEMPLATE/bug_report.md`](./.github/ISSUE_TEMPLATE/bug_report.md).
Please include:

- OS and architecture
- Bun and Node versions
- A minimal stdin JSON that reproduces the issue
- The output you got vs. what you expected (paste both with ANSI stripped if
  possible)

## Reporting security issues

**Do not open a public issue.** See [SECURITY.md](./SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be
kind. Disagree about ideas, not people.
