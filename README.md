# claudeline

[![npm version](https://img.shields.io/npm/v/@arcasilesgroup/claudeline.svg?logo=npm)](https://www.npmjs.com/package/@arcasilesgroup/claudeline)
[![CI](https://github.com/arcasilesgroup/claudeline/actions/workflows/ci.yml/badge.svg)](https://github.com/arcasilesgroup/claudeline/actions/workflows/ci.yml)
[![CodeQL](https://github.com/arcasilesgroup/claudeline/actions/workflows/codeql.yml/badge.svg)](https://github.com/arcasilesgroup/claudeline/actions/workflows/codeql.yml)
[![Security](https://github.com/arcasilesgroup/claudeline/actions/workflows/security.yml/badge.svg)](https://github.com/arcasilesgroup/claudeline/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A cross-platform statusline for [Claude Code](https://claude.com/claude-code).
TypeScript, single binary, zero config.

<p align="center">
  <img src="https://raw.githubusercontent.com/arcasilesgroup/claudeline/main/docs/screenshot-active-dark.png" alt="claudeline running inside Claude Code during an active session: model name with 1M context, ✍️ context %, working directory and dirty git branch, effort glyph, thinking indicator, 5-hour and weekly rate-limit bars, and the accept-edits permission hint" width="900" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arcasilesgroup/claudeline/main/docs/demo.gif" alt="claudeline animated demo: model, context %, dir+git, cost, effort, thinking, rate-limit bars filling up" width="900" />
</p>

## Features

- **Model + context %** — colored by usage threshold (green → orange → yellow → red)
- **Cost per session** — `💸 $X.XX` from Claude Code's authoritative server-side total, with a token×pricing fallback for older runtimes
- **Working directory + git** — branch, dirty flag, worktree marker (`⎇:branch`), optional `⚡` for `--dangerously-skip-permissions`
- **Session duration** — elapsed since session start
- **Effort indicator** — distinct glyphs for `max`, `xhigh`, `high`, `medium`, `low`
- **Thinking indicator** — 🧠 when extended thinking is enabled
- **Fast mode badge** — 🐇 when running with `--fast`
- **1M context warning** — 📚 when the session exceeds 200K tokens
- **Rate limits** — 5-hour, weekly, and optional extra credits, sourced from Claude Code stdin first, OAuth API as fallback
- **Rate-limit projection** — `~38m` next to the bar tells you when you'll hit 100% at the current burn rate
- **Latency badge** — `🐢 Xms` when the OAuth API is slow (yellow ≥1 s, red ≥3 s)
- **Locale-aware** — 12h / 24h auto-detected, timezone from system
- **Glyph modes** — `CLAUDELINE_GLYPHS=emoji` (default), `nerd` (NerdFont), `plain` (ASCII for SSH/no-emoji terminals)
- **Cross-platform** — macOS, Linux, Windows. Node ≥ 18, Bun, or one of our self-contained binaries

## Why this vs the bash original

There's an excellent bash statusline by [@kamranahmedse](https://github.com/kamranahmedse/claude-statusline) that inspired claudeline. If you're choosing between them, here's where claudeline diverges:

| | claudeline | bash original |
| --- | --- | --- |
| **macOS, Linux** | ✅ | ✅ |
| **Windows** | ✅ (npm shim + native binary) | ❌ requires bash + jq + curl |
| **Cost source** | server-side `cost.total_cost_usd` from Claude Code (truth) | derived from token math (drifts from reality) |
| **Rate-limit projection** | `~38m` at current burn rate | not present |
| **Latency badge** | yes, with yellow/red thresholds | not present |
| **Worktree-aware git** | `⎇:branch` | branch-only |
| **Fast mode + 1M context warnings** | yes | not present |
| **Tests** | comprehensive suite (TDD) | 0 |
| **Schema validation** | Zod, tolerant of `null` and unknown fields | none |
| **Distribution** | npm + Homebrew + Bun-compiled binaries (5 platforms) | source only |
| **Cold start (single render)** | ~85–140 ms p50 | ~30–60 ms (no Node runtime) |
| **Runtime deps** | `zod` only | `jq`, `curl`, `bash`, `git` |

If you want the leanest, no-runtime-deps option and you're macOS/Linux-only, the bash original is great. If you want a single tool that works the same on every platform with tested rendering, accurate cost, projections, and richer signals — that's what claudeline ships.

## Install

### npm (any platform with Node ≥ 18)

```bash
npm install -g @arcasilesgroup/claudeline
# or pnpm add -g @arcasilesgroup/claudeline
# or bun install -g @arcasilesgroup/claudeline
```

### Homebrew (macOS, Linux)

```bash
brew tap arcasilesgroup/claudeline
brew install claudeline
```

### Self-contained binary

Download the right asset from the [releases page](https://github.com/arcasilesgroup/claudeline/releases/latest), make it executable, drop it on your PATH:

```bash
# example for macOS arm64
curl -fsSL -o claudeline \
  https://github.com/arcasilesgroup/claudeline/releases/latest/download/claudeline-darwin-arm64
chmod +x claudeline && mv claudeline /usr/local/bin/
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
| Directory  | `cwd` basename + git branch + dirty flag + worktree |
| Cost       | `current_usage` tokens × Anthropic price for `model.id` |
| Session    | elapsed since `session.start_time`                  |
| Effort     | `effort.level` from stdin, fallback `effortLevel`   |
| Thinking   | `thinking.enabled`, fallback `alwaysThinkingEnabled`|
| Latency    | `⚡ Xms` when the OAuth API takes >1 s              |

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

### Glyph modes

Set the `CLAUDELINE_GLYPHS` environment variable in your shell or in
`~/.claude/settings.json` env block:

| Mode    | When to use                                                |
| ------- | ---------------------------------------------------------- |
| `emoji` | (default) emojis + Unicode geometric shapes                |
| `nerd`  | Patched [NerdFont](https://www.nerdfonts.com) terminal     |
| `plain` | SSH / `screen` / terminals without Unicode or emoji        |

### Rate-limit projection

When the 5-hour bar moves between two consecutive renders, claudeline
estimates how long until you hit 100% at the current pace and renders
`~38m` (or `~2h5m`) next to the percentage. The previous sample is
kept under `<tmpdir>/claudeline-<uid>/state.json` (`0o600`).

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
