# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/arcasilesgroup/claudeline/releases/tag/v0.1.0
