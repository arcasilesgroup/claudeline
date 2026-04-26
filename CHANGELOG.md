# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-04-27

### Security

- Closed a TOCTOU (CWE-367) gap in the usage cache reader. CodeQL
  flagged the `statSync` → `readFileSync` window in `loadJsonCache`.
  The reader now uses `openSync` with `O_NOFOLLOW` and operates on the
  file descriptor (`fstatSync` + `readSync`), so the file cannot be
  swapped out between the freshness check and the read. The writer is
  also hardened: it unlinks any pre-existing symlink, then writes via
  a tempfile + `renameSync` for atomicity, with `O_EXCL` (`flag: "wx"`)
  on the temp so an attacker cannot trick us into reusing a planted
  path.

### Added

- Tests pinning the symlink-replacement and `O_NOFOLLOW` behaviors
  (`tests/usage.test.ts`).

## [0.1.3] - 2026-04-27

### Fixed

- `claudeline --version` now prints the actual installed version (was
  hardcoded to `0.1.0`). The version is now read from `package.json`
  via a single `src/version.ts` module so it cannot drift again. The
  `User-Agent` sent to the OAuth API now includes the real version too.
- Context-percentage rounding is now consistent across the two code
  paths in `contextSegment`. Previously `usedPercentage` rounded to
  nearest while the token-math path used `Math.floor`, so the same real
  utilisation could render with different colors and labels depending
  on which Claude Code version was on the other end of stdin.
- Stdin Zod schemas now tolerate `null` in optional fields. Previously
  a payload like `{"effort":{"level":null}}` collapsed the entire
  statusline to `"Claude"` silently. Schemas use a small `nullish()`
  helper that accepts `T | null | undefined` so the consumer's existing
  `?? fallback` handles both.
- Extra-credits reset month now uses the user's timezone (from
  `Intl.DateTimeFormat().resolvedOptions().timeZone`) instead of the
  server's local clock. Cross-TZ users near month boundaries no longer
  see an off-by-one month label.
- `installer.install` warns to stderr when overwriting an existing
  `statusLine.command` that points at something other than `claudeline
  render`, so users migrating from another statusline tool know what
  was replaced.
- `installer` now writes `~/.claude/settings.json` atomically (write to
  a sibling tempfile, then rename) so a crash mid-write cannot corrupt
  user state. The temp file is also created with mode `0o600`.

### Performance

- Bundle size: **284 KB → 31 KB** (~9× smaller). Cold-start render
  dropped from ~250–400 ms to ~80–120 ms p50. Achieved by switching
  from `zod` to `zod/mini` (same author, function-style API).
- Three sequential `git` invocations collapsed into one
  `git --no-optional-locks status --porcelain --branch` call. Saves
  ~22 ms per render in a git repo.
- API timeout reduced from 5 s to 1.5 s. A slow network now caps user
  visible latency at ~1.5 s instead of ~5 s.

### Security

- Strip C0/C1 control characters from any stdin-sourced text we reflect
  to stdout (`model.display_name`, `cwd`, git branch). Defends against
  ANSI escape injection (terminal-title spoofing, OSC-8 hyperlinks,
  screen wipes) from a hostile branch name or repo path.
- `installer.ts` writes the temp settings file with mode `0o600` so
  secrets-adjacent state isn't world-readable on shared hosts.

### Added

- `tests/cli.test.ts` — 11 end-to-end CLI tests (`--version`, `--help`,
  unknown command, empty/malformed/null/oversize stdin, effort glyph)
  driven through the bundled `dist/cli.js`. The version-drift bug above
  would have been caught here.
- New tests for git status parser (detached HEAD, fresh repo, tracked
  branch, dirty/clean), `nextMonthFirstEpoch` (cross-TZ + December
  rollover), Windows backslash paths in `directorySegment`, and ANSI
  injection.

### Changed

- `directorySegment` splits on both `/` and `\` so Windows-style cwd
  values render as the basename instead of the full path.
- `extractRateLimitsFromInput` now takes a typed `StatuslineInput` and
  drops the runtime `as Record<string, unknown>` casts. The Zod schema
  is now the single source of truth for the stdin shape.
- Removed the dead `void homedir;` line in `cli.ts`. `homedir` was
  never used at this level.

## [0.1.2] - 2026-04-26

### Changed

- README screenshot replaced with a richer capture taken during an
  active session (dirty git branch, higher rate-limit utilization, and
  the accept-edits permission hint visible).
- The screenshot now ships with the GitHub-dark background applied,
  black padding, and 16 px rounded corners, so it integrates cleanly
  on both light and dark themes of github.com and the npm package page.

## [0.1.1] - 2026-04-26

### Changed

- README now leads with a real screenshot captured inside Claude Code
  instead of an ASCII art block. The image is referenced via absolute
  `raw.githubusercontent.com` URL so it renders identically on
  github.com and the npm package page.

### Maintenance

- CI: bumped `actions/checkout` v4 → v6, `actions/setup-node` v4 → v6,
  and `github/codeql-action` v3 → v4 to run on Node 24 ahead of the
  June 2026 deprecation of Node 20 in GitHub Actions.
- CI: migrated OSV vulnerability scan to the official
  `osv-scanner-action` v2 reusable workflow, which now uploads SARIF to
  the GitHub Security tab automatically.
- Tests: removed a brittle assertion that depended on the working tree
  being checked out on a branch named `main`; the remaining git tests
  use a temporary fixture repo and stay robust to detached HEAD checkouts.
- Defense-in-depth: cap stdin reads at 1 MiB; cache files written with
  `0600` inside a `0700` directory.

## [0.1.0] - 2026-04-26

### Added

- Initial release of `@arcasilesgroup/claudeline`.
- Cross-platform statusline for Claude Code (macOS, Linux, Windows).
- Single line displaying model, context %, working directory + git branch
  with dirty flag, session duration, effort level, and thinking indicator.
- Effort glyphs: `◉` for `max` / `xhigh`, `●` for `high`, `◑` for `medium`,
  `◔` for `low`.
- 12h / 24h time format auto-detected from
  `AppleICUForce24HourTime` → `AppleLocale` → `LC_TIME` / `LC_ALL` / `LANG`,
  with a sensible default per region.
- Rate-limit lines (5-hour, weekly, optional extra credits) sourced from
  stdin first, otherwise from the OAuth API with a 60-second file cache.
- OAuth token discovery across `CLAUDE_CODE_OAUTH_TOKEN`, macOS Keychain,
  Linux `secret-tool`, and `~/.claude/.credentials.json`.
- `claudeline install` / `claudeline uninstall` to wire the CLI into
  `~/.claude/settings.json`.

### Security

- Cache file written with `0600` permissions inside a `0700` directory.
- All external commands invoked via `child_process.spawnSync` with fixed
  argv arrays — no shell interpolation.
- API calls bounded by a 5-second `AbortController` timeout.
- Stdin and API responses validated by Zod schemas; malformed input is
  ignored and the CLI prints a safe fallback.

[Unreleased]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/arcasilesgroup/claudeline/releases/tag/v0.1.0
