# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/arcasilesgroup/claudeline/releases/tag/v0.1.0
