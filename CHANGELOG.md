# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.3] - 2026-04-28

UX fix on top of 0.4.2. Reported live: user added
`export CLAUDELINE_PREFER_API=1` to `.zshrc`, sourced it, ran
`claudeline refresh`, but the hint kept saying "set this env var" and
`doctor` still showed "stdin → api fallback (default)". Either the env
didn't propagate or claudeline didn't see it — and there was no way to
tell which from the inside. That's the kind of silent-failure / no-feedback
loop that breaks user trust.

### Added

- **Persistent config file** at `~/.claudeline/config.json` (JSON, mode
  `0o600`, owner-only). Mirrors the env-var surface but lives in a
  predictable spot so subprocess env propagation isn't load-bearing.
- **`claudeline config get | set | unset | edit`** — first-class
  commands so users don't have to hand-edit JSON or chase env-var
  precedence rules:
  - `claudeline config get` — shows resolved values *and* their source
    (`[env]` / `[config]` / `[default]`) plus verbatim env values.
  - `claudeline config set <key> <value>` — persists `prefer-api` or
    `cache-ttl-sec`. Validates type / range. Warns when env is also set.
  - `claudeline config unset <key>` — removes a setting; deletes the
    file when no settings remain.
  - `claudeline config edit` — opens the file in `$EDITOR`.
- **Doctor's Diagnostics now shows the effective source for every
  setting** plus the verbatim env values claudeline actually sees:
  - `Rate-limit source: api (refresh moves the bar) [from config]`
  - `Cache TTL: 30s [from default]`
  - `CLAUDELINE_PREFER_API env: "1"` or `(unset)`
  - `CLAUDELINE_CACHE_TTL_SEC env: (unset)`
  - `Config file: /Users/me/.claudeline/config.json (present)`

  This is the diagnostic that fixes the "I exported it but it doesn't
  work" failure mode — users can now see at a glance whether their env
  reached claudeline, where the active value came from, and where to
  put a persistent override.

### Changed

- **Settings precedence:** env > config > default. Same env-var names
  as 0.4.2, but with the file fallback now in place. Setting a value
  via `claudeline config set` is sufficient — no shell rc edit, no
  reload, no env propagation worries.
- **Refresh hint slimmed** from a 3-line paragraph to one line. Points
  at the new `claudeline config set prefer-api true` instead of the
  env-var dance. Suppressed entirely when `prefer-api` is already on.

### Internal

- New `src/config.ts` (~140 LOC pure functions: `readConfig`,
  `writeConfig`, `ensureConfigFile`, `deleteConfig`, `resolveBoolean`,
  `resolveSeconds`). All resolution helpers are reusable for future
  settings.
- `DoctorEnv` gains `cacheTtlSource`, `preferApiSource`,
  `envPreferApi`, `envCacheTtlSec`, `configFile`, `configFilePresent`
  so the diagnostic block stays a pure transform of the env, no fs
  access from doctor itself.

### Tests

- 336 → 356 (+20). New `tests/config.test.ts` covers read/write
  round-trip, malformed-file tolerance, type rejection at read time,
  ensureConfigFile idempotency, full env→config→default precedence
  for both boolean and seconds resolvers (including out-of-range
  fallback). Updated `tests/doctor.test.ts` for the new wording +
  source tags.

## [0.4.2] - 2026-04-28

Honesty patch on top of 0.4.1's freshness work. Reported by a user who
ran `claudeline refresh` twice and the statusline didn't move — turns
out `refresh` only updates the OAuth-API cache, but recent Claude Code
versions pass `rate_limits` directly in stdin and the renderer uses
that source by default. The cache update was happening; nobody was
reading it.

### Added

- **`CLAUDELINE_PREFER_API=1`** — opt-in env var that makes the
  renderer ignore `input.rate_limits` from stdin and always read from
  the OAuth-API cache. Now `claudeline refresh` actually drives what's
  shown for users who set this. Trade-off: one extra API fetch when the
  cache expires, and you lose "always as fresh as my session knows".
- **Diagnostics line in `doctor`**: `Rate-limit source: stdin → api
  fallback (default)` or `Rate-limit source: api (CLAUDELINE_PREFER_API=1)`.
  Surfaces which path is in effect so users know what `refresh` will
  actually drive.
- **`claudeline refresh` hint** — when running without
  `CLAUDELINE_PREFER_API=1`, the command now prints a note explaining
  that stdin probably overrides the cache, and how to opt in. The hint
  is suppressed when the env var is already set.

### Changed

- **`RenderDeps.preferApi: boolean`** (optional) — internal-only,
  threaded from cli.ts to render.ts. `DoctorEnv.preferApi` is the
  required mirror for the doctor diagnostic.

### Internal

- New `parseBooleanEnv` helper in cli.ts (accepts `1` / `true` / `yes`
  case-insensitive; everything else → false). Used for
  `CLAUDELINE_PREFER_API`; reusable for future opt-in flags.

### Tests

- 329 → 336 (+7). New SWR-with-preferApi cases in `tests/render.test.ts`
  (preferApi=true skips stdin even when present; preferApi=false keeps
  stdin priority). New `parseBooleanEnv` parser tests in
  `tests/cli.test.ts`. New rate-limit source diagnostic tests in
  `tests/doctor.test.ts`.

## [0.4.1] - 2026-04-28

Freshness improvements for the rate-limit ribbon. The statusline still
refreshes only when Claude Code triggers a render — that's a property
of the host contract, not something we can change — but when it *does*
trigger we now serve fresher data and surface the cache state explicitly
so users can debug "claudeline says 42% but claude.ai says 51%" without
guessing.

### Added

- **Stale-while-revalidate cache.** Renders below the SWR threshold
  (5 s) serve cached data immediately, no API call. Renders between 5 s
  and the TTL ceiling serve cached data *and* spawn a detached
  `claudeline _refresh` subprocess so the next render sees fresh
  numbers. Renders past the TTL fetch synchronously, as before.
- **Cache TTL configurable via `CLAUDELINE_CACHE_TTL_SEC`.** Default
  dropped from 60 s → 30 s; clamped to [1, 300] s; invalid values fall
  back to 30 s silently (the hot path never crashes on a fat-fingered
  env var).
- **`claudeline refresh`.** User-facing: forces a synchronous OAuth
  fetch and writes the cache. Useful when you want the freshest numbers
  before a critical decision (e.g. "am I really under the 5h cap?").
  Internal `_refresh` variant is the silent backend the SWR spawn calls.
- **Cache age in `doctor`.** New Diagnostics line:
  `Cache age: 23s (TTL 30s)` (or `Cache: empty (TTL 30s)` if no cache
  yet). Surfaces in both the human and `--json` outputs so you can
  correlate stale numbers with cache freshness.

### Changed

- **`RenderDeps.cacheLoad`** now returns `{ cache, ageMs } | undefined`
  instead of `CachedUsage | undefined`. The cli wires the TTL gate; the
  render path uses the age to decide between fresh-serve, SWR-serve,
  and sync-fetch. Type-only break — `RenderDeps` is internal-only, no
  downstream consumer.
- **`DoctorEnv`** gains required `cacheAgeMs(): number | undefined` and
  `cacheTtlMs: number` fields so the new Diagnostics line stays pure
  (no fs access from doctor itself). Same internal-only type, no
  external impact.

### Internal

- New `loadJsonWithMeta` / `loadJsonCacheWithAge` helpers in
  `safeJsonFile.ts` / `cache.ts`. Same security posture as `loadJson`
  (O_NOFOLLOW, fd-based read) but exposes mtime so SWR callers can
  decide age semantics.

### Tests

- 320 → 329 (+9). New SWR coverage in `tests/render.test.ts` (fresh
  cache → no spawn / no fetch; stale cache → spawn but no sync fetch;
  missing cache → sync fetch path; tolerates absent
  `refreshInBackground`). New `resolveCacheTtlMs` parser tests in
  `tests/cli.test.ts` (default, in-range, out-of-range fallback). New
  cache-age formatter cases in `tests/doctor.test.ts` (empty, custom
  TTL display).

## [0.4.0] - 2026-04-28

Adoption-driven feature bundle. All additive — no breaking changes to
shipped 0.3.x CLI surface.

### Added

- **`claudeline summary`** — opt-in local cost / session history. Run
  `claudeline summary --enable` to start logging one record per render
  to `~/.claudeline/sessions.jsonl`. The summary command rolls totals
  across today / this-week / this-month / all-time windows, broken out
  by model. All data stays on the user's machine; `--disable` deletes
  the log. JSON output via `--json` for dashboards.
- **`claudeline render --json`** — emits the structured data behind the
  ANSI statusline (model, cost with source attribution, context window,
  session, rate limits with projection, latency p50/p99). Stable schema;
  intended for editor / dashboard integrations that don't want to parse
  ANSI.
- **`claudeline doctor --json`** — same checks the human report runs,
  emitted as a structured payload (sections + lines + summary) so
  scripts and CI can parse the diagnosis without ANSI.
- **One-line installer** (`scripts/install.sh`) — detects platform,
  downloads the right Bun-compiled binary from the latest GitHub
  release, verifies SHA256, drops it in `~/.local/bin/`, runs
  `claudeline install`. Documented in the README under "Install" as the
  primary path for users without Node installed globally.
- **Marketing playbook** (`docs/MARKETING.md`) — internal doc tracking
  community-list submissions, launch posts, and one-line pitches we
  can re-use across channels. Not published to npm.

### Changed

- **`DoctorReport.lines` removed** — flattened view is now derived via
  the new exported `flattenLines(report)` helper. Internally `runDoctor`
  no longer carries the redundant field; the summary computes off
  `sections.flatMap(...)`. Tests that previously read `report.lines`
  now use `flattenLines(report)`. Schema-level: this is a breaking
  type-only change for any downstream consumer that imported
  `DoctorReport`, but the package has no library `exports` map so no
  realistic external consumer exists.
- **`paint(text, ansi)` → `paint(text, ansi, enabled = true)`** — the
  helper now takes an optional flag so doctor's NO_COLOR-aware code can
  call `paint(body, ansi, color)` instead of inlining its own
  conditional wrapper. Backward-compatible default (`enabled = true`)
  preserves the previous behaviour for `segments.ts` and other
  unconditional callers.
- **Remotion compositions** (`docs/remotion/src/`) — extracted shared
  `BASE_COLORS`, `EXTRA_COLORS`, `FONT`, `appearAt`, `colorForPct` to a
  new `_helpers.ts`. `Cli.tsx` and `Statusline.tsx` previously inlined
  near-duplicate copies; one source of truth keeps both demos in sync
  when the palette evolves. Cli.tsx also gained a `<Section>` helper
  that collapses the three Diagnostics / Configuration / Health blocks
  into data-driven calls.

### Internal

- `tests/_mockDeps.ts`: clarifying comment on the `now` choice
  (2026-04-26T20:00:00Z). Investigated the question raised in the
  0.3.3 review — the unification across `render.test.ts` and
  `fixtures.test.ts` is intentional; chosen so fixture `resets_at`
  values sit in the future and the renderer exercises the
  "still counting down" branch.
- New `src/sessionLog.ts` (~200 LOC, pure functions + a couple of
  filesystem helpers). Logging is opt-in via the file's existence;
  reader dedups by session_id with last-write-wins semantics.

### Tests

- 304 → 320 (+16). Most additions in `tests/sessionLog.test.ts`
  (lifecycle, dedup, malformed-line tolerance, summarize windows + by-
  model breakdown) and `tests/render.test.ts` (renderStatuslineData
  shape, server-vs-estimated cost source, rate-limits passthrough,
  null-out semantics for absent fields). `tests/cli.test.ts` covers
  `doctor --json` end-to-end against the bundled binary.

## [0.3.3] - 2026-04-28

Follow-ups from a second multi-agent review of the 0.3.x bundle. No
runtime behaviour change beyond the README sample and `--help` text:
test coverage for the new doctor format, a half-asserted fixture
matrix tightened up, and assorted doc/comment drift swept.

### Fixed

- **Docs:** README sample summary said `5 ok`; the same scenario
  actually emits `6 ok` (Configuration: 4, Health: 2). Anyone copying
  the example and running `claudeline doctor` would have seen a
  different count and second-guessed their environment.
- **Help text:** `claudeline --help` previously described `doctor` as
  a `pass/fail` report; aligned with the README's `pass/warn/fail`
  framing now that warnings have their own bubble-out block.

### Tests

- New coverage for the doctor format introduced in 0.3.1: top rule
  (`─` × 72), `Platform: <os>-<arch>` and `Cache directory: <path>`
  diagnostic lines, singular `1 error` summary branch, empty-section
  header skip when every leaf bubbles out as an issue, and issues
  block traversal order across sections.
- Fixture diversity matrix now asserts both `large=true` and
  `large=false` (previously the positive side was missing, so
  deleting all `exceeds_200k_tokens: true` fixtures would have
  passed silently). Diversity flags are now derived from
  schema-parsed payloads rather than raw JSON, so a malformed
  fixture surfaces as a parse error instead of "no smallCost".
- `tests/doctor.test.ts` now imports `stripAnsi` from
  `tests/_mockDeps.ts` instead of inlining its own copy.

### Internal

- `docs/remotion/src/Cli.tsx`: dropped the dead `color` prop on
  `Line` (no caller passed it), folded `Branch`'s two same-style
  spans into one, and corrected the stale `Total: 360 frames`
  comment (the actual hold is ~258 frames per `Root.tsx`). Hardcoded
  version label bumped to 0.3.3 with a note to keep in sync per
  release.
- Stale comment in `tests/cli.test.ts` describing the lazy import as
  "loading the cli module" updated — the imports moved to
  `cache.js` in 0.3.1.

### Tests

- 302 → 304 (two new `doctor.test.ts` cases for empty-section skip
  and issues-block order; new assertions inside existing tests for
  the top rule, Platform/Cache directory lines, singular `1 error`,
  and the positive side of the fixture diversity matrix).

## [0.3.2] - 2026-04-27

Polish bundle. No runtime behaviour change — five follow-ups from
the multi-agent review of 0.3.0/0.3.1, plus two distinct demo GIFs
in the README.

### Changed

- **Docs:** `claudeline doctor` is now embedded in the README with a
  full sample of its sectioned/tree-style output and mention of
  `NO_COLOR` support.
- **Demo gifs:** the README now embeds two distinct gifs —
  `demo-statusline.gif` (the live ribbon, unchanged from before) and
  `demo-cli.gif` (a new animated reveal of the doctor output). The
  Remotion project gained a sibling composition (`Cli.tsx`) plus
  `render:gif:statusline` / `render:gif:cli` / `render:gif:all` npm
  scripts.

### Internal

- `adoptCachedUsage` now lives in `src/cache.ts` alongside the rest
  of the cache plumbing, instead of a separate `cli-shared.ts`
  module. The architecture review flagged the old name as
  "by caller, not by domain"; folding it into `cache.ts` removes
  that doc-debt and the back-compat re-export from `cli.ts`.
- `tests/_mockDeps.ts`: extracted shared `mockDeps(overrides)` +
  `stripAnsi` helpers used by `tests/render.test.ts` and
  `tests/fixtures.test.ts`. One source of truth for the `RenderDeps`
  shape so future evolutions don't drift across files.
- Two more fixtures: `active-session-fast-mode.json` (`fast_mode: true`,
  cost < $1) and `active-session-small-cost.json` (3-decimal cost,
  no extended thinking). The fixture-diversity assertion the testing
  review suggested is now a real test, not implicit.

### Tests

- 293 → 302 (+9). New `mockDeps` helper, fixture-diversity assertion,
  per-fixture parse + render runs across the two new payloads.

## [0.3.1] - 2026-04-27

### Changed

- **`claudeline doctor` UX overhaul** to match `claude doctor`. Output
  now opens with a horizontal rule and groups facts into three bold
  sections: **Diagnostics** (claudeline version, Node/Bun engine,
  platform, cache directory), **Configuration** (statusLine wired,
  effortLevel, cache permissions, stdin schema), and **Health** (cache
  shape, state file shape). Each section renders as a tree with
  ` ├ ` / ` └ ` branch chars instead of a flat emoji-prefixed list.
  Warnings and errors bubble out of their section into a dedicated
  block beneath the report, with the eye-catching ⚠ / ✗ marker and a
  tree-indented action item — clig.dev's "put the most important
  information at the end" pattern.
- `printReport` now honors `NO_COLOR`, `TERM=dumb`, and pipes (non-TTY
  stdout) — ANSI escapes are dropped automatically when the consumer
  isn't a colour-capable terminal. Per [no-color.org][nc] / clig.dev.

[nc]: https://no-color.org

### Added

- New diagnostic facts in the doctor output: `Platform: <os>-<arch>`
  and `Cache directory: <path>`. Both pure info — same data was
  available before but only via `os.platform()` and reading
  `process.env.TMPDIR`.

### Tests

- Refactored doctor test suite to assert the new section structure,
  tree-style output, NO_COLOR opt-out, and singular/plural summary
  text. 291 → 293 tests (+2 net).

## [0.3.0] - 2026-04-27

The first feature release on top of the 0.2.x bug-fix run. Six new
capabilities, all reusing existing hardening primitives.

### Added

- **`claudeline doctor` — diagnostic subcommand.** Runs eight read-only
  checks against your environment and prints a pass/warn/fail report
  with actionable fixes. Detects `CLAUDE_CODE_EFFORT_LEVEL` env var
  overrides (the bug we hit during 0.2.x debugging), missing or
  malformed `~/.claude/settings.json`, cache directory permissions,
  malformed/symlinked cache file, broken state file, unknown effort
  levels, and Node/Bun engine info. Always exits 0 — informational
  only, never modifies anything.
- **API latency p50/p99 sliding window.** When the `🐢 Xms` badge
  fires, claudeline now also shows `(p50:Y/p99:Z)` derived from up to
  60 minutes of samples. Persisted to the existing `state.json` with
  the same hardened primitives. Renders only after ≥5 samples (below
  that, percentiles are noise).
- **Fast mode badge** — 🐇 (cyan) appears when `stdin.fast_mode` is
  true. Useful as a "did I forget I'm on `--fast`?" reminder.
- **1M context warning** — 📚 (yellow) appears when
  `stdin.exceeds_200k_tokens` is true. Heads-up that you're past the
  cliff where pricing tier may shift and the model gets slower.
- **Three real Claude Code stdin fixtures** in `tests/fixtures/`,
  validated against the schema and renderer. Catches regressions when
  Anthropic ships a new field shape.
- **README "Why this vs the bash version"** section comparing
  claudeline to [@kamranahmedse/claude-statusline] across cost source,
  rate-limit projection, latency badge, glyph modes, tests, etc. For
  adoption.

[@kamranahmedse/claude-statusline]: https://github.com/kamranahmedse/claude-statusline

### Changed

- **CI cross-compiles `darwin-x64` from `macos-latest`** (arm64 host)
  instead of `macos-13`. The macos-13 runners had been queueing 20+
  minutes per release through the 0.2.x line, forcing manual
  cross-compile every time. Bun supports cross-target compilation, so
  this just works and ends the recurring operational paper-cut.

### Schema

- Stdin schema now reads `cost.total_cost_usd`, `fast_mode`, and
  `exceeds_200k_tokens`. All optional and tolerant of `null`.

### Tests

- 205 → 291 tests (+86). New suites: `fixtures.test.ts`,
  `doctor.test.ts`, expanded `state.test.ts` and `segments.test.ts`
  for latency window and the two new badges.

## [0.2.5] - 2026-04-27

### Changed

- `safeJsonFile.loadJson` now skips the explicit `lstatSync` symlink
  check on POSIX and relies entirely on `O_NOFOLLOW` for symlink
  rejection. The previous code did both, which closed CodeQL's
  symlink-following alert but introduced a tiny TOCTOU window
  (`js/file-system-race`, CWE-367) between the check and the open.
  POSIX now has zero TOCTOU window. Windows still uses the lstat
  pre-check (because Windows ignores `O_NOFOLLOW`); the cache and
  state files live in a per-uid `0o700` directory so any attacker
  capable of swapping the file already shares the UID, making the
  race irrelevant in practice.

## [0.2.4] - 2026-04-27

### Fixed

- **Cost segment now reports the real cumulative session cost.**
  0.2.0–0.2.3 derived the figure from `context_window.current_usage`
  multiplied by Anthropic's price table, but `current_usage` is only
  the *last turn*'s token delta, not the running session sum. So the
  number we printed jumped around with each prompt and severely
  understated the real spend (e.g. `💸 $1.32` while Claude Code's
  internal tracker said $225+ for the same session). Claude Code
  always emits `cost.total_cost_usd` in the statusline JSON; we now
  prefer that authoritative figure and only fall back to local
  token×price computation when it is absent. The local fallback is
  retained because older Claude Code releases may not emit `cost`
  and because it lets cost still render in tests with synthetic
  payloads.

## [0.2.3] - 2026-04-27

### Fixed

- **Windows symlink rejection** in the cache and state file readers.
  `loadJsonCache` / `loadState` rely on `O_NOFOLLOW` to refuse a
  pre-planted symlink, but Windows ignores that flag. The reader now
  does an explicit `lstatSync(...).isSymbolicLink()` check before the
  open, which works on every platform. POSIX users keep `O_NOFOLLOW`
  as a defense-in-depth second line. Also fixes the corresponding
  test failures on the Windows CI runner (which were the only
  Windows-test regressions in 0.2.x).

## [0.2.2] - 2026-04-27

### Changed

- README demo extended from 8 s to 11 s with a longer hold so the
  finished statusline stays on screen long enough to read. The bars
  now visibly walk through every color threshold (green → orange →
  yellow → red on `current` 0→95%, green → orange → yellow on
  `weekly` 0→75%) so the colour-coding is part of the demo. The
  whole composition is now wrapped in a rounded GitHub-dark card,
  matching the existing static screenshot aesthetic.

### Security

- Bumped the Remotion subproject's pinned `webpack` from 5.96.1 to
  5.106.2 via `package.json overrides` to clear two GitHub
  Code-Scanning alerts (CVE-2025-68458 / GHSA-8fgc-7cc6-rx7x and
  CVE-2025-68157 / GHSA-38r7-794h-5758). Both bugs require
  `experiments.buildHttp` which Remotion does not enable, so the
  shipped binary was never affected — the subproject is dev-only and
  not in the npm tarball — but cleaning the alert keeps the dashboard
  honest.

## [0.2.1] - 2026-04-27

### Fixed

- **Critical**: 0.2.0 silently produced no output when invoked through
  the `claudeline` shim because the entrypoint guard compared
  `process.argv[1]` against `cli.js` *without* resolving symlinks.
  npm and `bun link` install a shim that points at the bundled
  `cli.js`, so the basename never matched and `main()` never ran.
  Now uses `realpathSync(process.argv[1])` so the chain
  `claudeline → ~/.bun/bin/claudeline → dist/cli.js` resolves
  correctly and `--version` / `render` work whether invoked from
  the shim, npm, brew, or directly.

## [0.2.0] - 2026-04-27

The first feature release on top of the 0.1.x security/quality groundwork.

### Added

- **Cost per session.** A `💸 $X.XX` segment after the directory shows
  the running session cost, derived from `current_usage` token counts
  multiplied by the model's published Anthropic price. Pricing covers
  Opus 4.x, Sonnet 4.x, Haiku 4.x and 3.5, plus the common short
  aliases (`opus`, `sonnet`, `haiku`). Unknown models render no segment
  rather than guessing.
- **Rate-limit projection.** When the 5-hour usage bar is shown,
  claudeline persists the last sample to `<tmpdir>/claudeline-<uid>/state.json`
  and on the next render computes the burn rate. If the bar is rising,
  a `~Nm` (or `~Nh) is rendered to its right — your projected time-to-100%
  at the current pace. The state file is hardened with the same
  `O_NOFOLLOW` + atomic `wx`-tempfile pattern as the cache.
- **Latency badge.** When the OAuth API takes longer than 1 s, a
  `⚡ Xms` badge is appended to line 1 (yellow at 1–3 s, red beyond).
  The latency is timed in `fetchUsage` and persisted in the cache so it
  survives the 60 s window.
- **Worktree-aware git status.** Detects linked git worktrees via
  `git rev-parse --git-dir` and prefixes the branch name with `⎇:` so
  it's distinguishable from the main checkout. Adds one cheap `git`
  call only when already inside a repo.
- **Glyph mode** via `CLAUDELINE_GLYPHS` environment variable: `emoji`
  (default), `nerd` (NerdFont icons + emoji where they look great),
  `plain` (pure ASCII for SSH/screen/no-emoji terminals). Three full
  glyph tables in `src/glyphs.ts`.
- **Self-contained binaries.** Every release now ships Bun-compiled
  binaries (`claudeline-darwin-arm64`, `claudeline-darwin-x64`,
  `claudeline-linux-x64`, `claudeline-linux-arm64`,
  `claudeline-windows-x64.exe`) plus an `.sha256` sidecar each. Users
  without Node can `curl | install` directly.
- **Homebrew tap** at
  [`arcasilesgroup/homebrew-claudeline`](https://github.com/arcasilesgroup/homebrew-claudeline).
  `brew tap arcasilesgroup/claudeline && brew install claudeline`
  consumes the binary release assets.
- **Demo GIF** in the README.

### Changed

- `RenderDeps` now requires `glyphs`, `loadState`, `saveState`. The
  cache wraps the API response in `{ data, latencyMs, fetchedAt }`
  rather than storing it directly, which is also what the latency
  badge reads. Loaders defensively detect the old shape and discard
  stale entries (the 60 s TTL means at worst one extra fetch).
- `fetchUsage` now returns `{ data, latencyMs } | undefined` instead
  of `UsageApiResponse | undefined`.
- Segment functions (`contextSegment`, `directorySegment`,
  `sessionSegment`, `effortSegment`, `thinkingSegment`) take a
  `GlyphSet` so the visual tokens are pluggable per render.

### Security

- The new `state.json` file follows the same hardening as the cache:
  per-uid directory (`<tmpdir>/claudeline-<uid>/`), `0o700` directory,
  `0o600` file, `O_NOFOLLOW` reads, atomic `wx`-tempfile + rename, and
  pre-existing-symlink rejection.

## [0.1.5] - 2026-04-27

### Security

- Cache directory is now per-uid (`<tmpdir>/claudeline-<uid>/usage-cache.json`)
  so co-tenants on a shared host cannot plant symlinks in our namespace
  or read our cache contents. Closes [CWE-377/378] (Insecure Temporary
  File) flagged by CodeQL on 0.1.4. The existing `0o700` directory and
  `0o600` file modes remain in place; the per-uid prefix makes cross-uid
  attacks impossible regardless of those modes.

[CWE-377/378]: https://cwe.mitre.org/data/definitions/377.html

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

[Unreleased]: https://github.com/arcasilesgroup/claudeline/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/arcasilesgroup/claudeline/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/arcasilesgroup/claudeline/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/arcasilesgroup/claudeline/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/arcasilesgroup/claudeline/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/arcasilesgroup/claudeline/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/arcasilesgroup/claudeline/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/arcasilesgroup/claudeline/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/arcasilesgroup/claudeline/releases/tag/v0.1.0
