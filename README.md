# claudeline

[![npm version](https://img.shields.io/npm/v/@arcasilesgroup/claudeline.svg?logo=npm)](https://www.npmjs.com/package/@arcasilesgroup/claudeline)
[![CI](https://github.com/arcasilesgroup/claudeline/actions/workflows/ci.yml/badge.svg)](https://github.com/arcasilesgroup/claudeline/actions/workflows/ci.yml)
[![CodeQL](https://github.com/arcasilesgroup/claudeline/actions/workflows/codeql.yml/badge.svg)](https://github.com/arcasilesgroup/claudeline/actions/workflows/codeql.yml)
[![Security](https://github.com/arcasilesgroup/claudeline/actions/workflows/security.yml/badge.svg)](https://github.com/arcasilesgroup/claudeline/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A cross-platform statusline for [Claude Code](https://claude.com/claude-code).
TypeScript, single binary, zero config.

<p align="center">
  <img src="https://raw.githubusercontent.com/arcasilesgroup/claudeline/main/docs/screenshot-dark.png" alt="claudeline running inside Claude Code: model name with 1M context, ✍️ context %, working directory and git branch, effort glyph, thinking indicator, and 5-hour and weekly rate-limit bars" width="900" />
</p>

## Features

- **Model + context %** — colored by usage threshold (green → orange → yellow → red)
- **Working directory + git** — branch, dirty flag, optional `⚡` for `--dangerously-skip-permissions`
- **Session duration** — elapsed since session start
- **Effort indicator** — distinct glyphs for `max`, `xhigh`, `high`, `medium`, `low`
- **Thinking indicator** — 🧠 when extended thinking is enabled
- **Rate limits** — 5-hour, weekly, and optional extra credits, sourced from
  Claude Code stdin first, OAuth API as fallback
- **Locale-aware** — 12h / 24h auto-detected, timezone from system
- **Cross-platform** — macOS, Linux, Windows. Node ≥ 18 or Bun

## Install

```bash
# npm
npm install -g @arcasilesgroup/claudeline

# pnpm
pnpm add -g @arcasilesgroup/claudeline

# bun
bun install -g @arcasilesgroup/claudeline
```

Wire it into Claude Code:

```bash
claudeline install
```

This adds the following to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "claudeline render"
  }
}
```

Restart Claude Code. Done.

To revert:

```bash
claudeline uninstall
```

## What it shows

The first line is composed of these segments, separated by `│`:

| Segment    | Source                                              |
| ---------- | --------------------------------------------------- |
| Model      | `model.display_name` from stdin                     |
| Context %  | `context_window` (tokens / size or used_percentage) |
| Directory  | `cwd` basename + git branch + dirty flag            |
| Session    | elapsed since `session.start_time`                  |
| Effort     | `effort.level` from stdin, fallback `effortLevel`   |
| Thinking   | `thinking.enabled`, fallback `alwaysThinkingEnabled`|

When Claude Code provides rate limits in the stdin JSON, those are used
directly. Otherwise claudeline calls the OAuth usage API once per minute and
caches the response under the OS temp directory with `0600` permissions.

### Effort glyphs

| Level     | Glyph | Color   |
| --------- | ----- | ------- |
| `max`     | ◉     | magenta |
| `xhigh`   | ◉     | magenta |
| `high`    | ●     | magenta |
| `medium`  | ◑     | dim     |
| `low`     | ◔     | dim     |

### 12h vs 24h

Detected automatically:

1. macOS preference `AppleICUForce24HourTime` (if explicitly set)
2. macOS `AppleLocale`
3. `LC_TIME` / `LC_ALL` / `LANG` environment variables
4. Default: 24h, except regions `US` / `CA` (12h)

Timezone comes from `Intl.DateTimeFormat().resolvedOptions().timeZone`.

### OAuth token sources (fallback only)

When Claude Code does not supply rate limits in stdin, claudeline looks up
the OAuth token to call the usage API:

1. `CLAUDE_CODE_OAUTH_TOKEN` environment variable
2. macOS Keychain (`security find-generic-password -s "Claude Code-credentials"`)
3. Linux `secret-tool` (libsecret)
4. `~/.claude/.credentials.json`

The token is **never** written to disk, logged, or sent to any host other
than `api.anthropic.com`.

## CLI usage

```text
claudeline render        Read JSON from stdin and emit the statusline
claudeline install       Wire claudeline as the statusLine in ~/.claude/settings.json
claudeline uninstall     Remove claudeline from ~/.claude/settings.json
claudeline --help        Show this help
claudeline --version     Show version
```

## Local development

You need [Bun](https://bun.com) ≥ 1.3.

```bash
git clone https://github.com/arcasilesgroup/claudeline
cd claudeline
bun install
bun test          # 100 tests
bunx tsc --noEmit # strict TS, exact optional, no implicit any
bun run build     # produces dist/cli.js for npm
```

Run against a fixture:

```bash
echo '{"model":{"display_name":"Opus 4.7"},"effort":{"level":"max"},"cwd":"."}' \
  | bun src/cli.ts render
```

Build a self-contained binary for your platform:

```bash
bun build src/cli.ts --compile --outfile=dist/claudeline
./dist/claudeline --version
```

## Project principles

This codebase is small on purpose:

- **TDD** — every module has tests written alongside (or before) the code.
  See [`tests/`](./tests).
- **SDD** — [`src/schemas.ts`](./src/schemas.ts) (Zod) is the source of truth
  for the input JSON contract, the OAuth usage API response, and
  `~/.claude/settings.json`.
- **DRY / KISS / YAGNI** — no plugin systems, no abstractions for
  unimplemented features, no half-finished code.
- **SOLID** — segments are pure functions; side-effecting code (git,
  network, filesystem) is injected into the orchestrator
  (`renderStatusline`) so it can be tested without mocks.

## Security

claudeline is non-privileged and minimal-surface. Highlights:

- Single runtime dependency: [`zod`](https://zod.dev) for input validation
- All external commands invoked with `child_process.spawnSync` using fixed
  argv arrays (no shell interpolation)
- HTTP calls bounded by a 5 s `AbortController` timeout
- Cache files written with `0600` inside a `0700` directory, contain only
  rate-limit metadata
- CI runs CodeQL, gitleaks, OSV-Scanner, and `bun audit` on every PR
  and weekly

Found a security issue? Please use
[private vulnerability reporting](https://github.com/arcasilesgroup/claudeline/security/advisories/new)
or follow the process in [SECURITY.md](./SECURITY.md). Do **not** open a
public issue.

## Contributing

PRs welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © Arcasiles Group
