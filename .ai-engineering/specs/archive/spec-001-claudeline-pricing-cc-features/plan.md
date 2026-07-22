---
execution_route:
  version: 1
  spec: spec-001
  executor: autopilot
  safe_next_command: "/ai-autopilot"
automation: dispatch
concern_count: 9
estimated_files: 12
reason: "Multi-concern spec (pricing source, unified resolver, cost dedupe, recompute default, BYO detection, effort/context parity, null handling, cleanup, docs). >=3 concerns and >=10 file changes per CLAUDE.md chain rule -> autopilot wraps the build."
status: draft
---

# Plan — spec-001: claudeline pricing fidelity for open models + CC feature parity

Decomposed from `spec.md` (approved). Phases are TDD-ordered: a RED test task precedes
every GREEN implementation task. Mechanical edits carry a `Patch` hunk; synthesized
logic carries prose only.

## Phase 0 — Pricing source layer + bundled snapshot

- [ ] T-0.1 — Extract bundled snapshot from `TABLE`
  - Agent: build
  - Files: `src/pricing.ts:20-77`
  - Principles applied: §10.3 SOLID, §10.6 SDD
  - Patch (deterministic): hard-move the 6 Anthropic rows in `TABLE` into a new
    `src/pricing.snapshot.json` (the seed). Delete the inline `const TABLE` array and
    its header comment (`src/pricing.ts:3-19`). Keep `ModelPricing` import path stable.
  - Gate: `tsc --noEmit` clean; snapshot JSON parses.

- [ ] T-0.2 — Create `src/pricingSource.ts` (fetch + cache + fallback)
  - Agent: build
  - Files: `src/pricingSource.ts` (new), `src/pricing.ts:79-86`
  - Principles applied: §10.1 KISS, §10.2 YAGNI, §10.5 TDD
  - Patch (deterministic): new module exporting `loadPricingCache()` (reads
    `pricing.snapshot.json`, fetches OpenRouter `/api/v1/models` + models.dev
    `api.json` on startup + daily, writes `pricing.cache.json`, logs + falls back on
    failure) and `resolvePrice(modelId)` (open/BYO -> OpenRouter map; anthropic ->
    models.dev map; bundled as final fallback). No config file/env in v1 (Decision 4-5).
  - Gate: module compiles; fetch-failure path returns bundled rows (unit-tested).

- [ ] T-0.3 — RED test: resolvePrice for open/BYO from snapshot
  - Agent: verify
  - Files: `tests/pricingSource.test.ts` (new)
  - Principles applied: §10.5 TDD
  - Patch (deterministic): assert `resolvePrice("openrouter/anthropic/claude-...")`,
    `resolvePrice("gpt-4o")`, `resolvePrice("llama3")` return defined rows; offline
    returns bundled Anthropic rows. Test fails until T-0.2 done.
  - Gate: test RED (compiles, fails).

## Phase 1 — Unified resolver (replaces substring pricingFor)

- [ ] T-1.1 — Provider tagging from `model.id` prefix
  - Agent: build
  - Files: `src/pricingSource.ts` (new), `src/pricing.ts:79-86`
  - Principles applied: §10.3 SOLID, §10.7 Clean Code
  - Patch (deterministic): `resolvePrice` maps `openrouter/...` and non-`claude`/
    non-`anthropic` ids to the OpenRouter source; `claude-*`/`anthropic/*` to the
    models.dev source. Exact-id map first, then fuzzy substring fallback (removes the
    order-dependence warned at `src/pricing.ts:9-13`).
  - Gate: unit test — `resolvePrice("claude-opus-4-7")` === Anthropic row;
    `resolvePrice("gpt-4o")` === OpenRouter row.

- [ ] T-1.2 — Swap callers from `pricingFor` to `resolvePrice`
  - Agent: build
  - Files: `src/render.ts:195` (`pricingFor(input.model?.id)`), `src/render.ts:318`
    (`costSegment(...)`), `src/pricing.ts:79-86` (delete `pricingFor`)
  - Principles applied: §10.7 Clean Code, §10.3 SOLID
  - Patch (deterministic): replace both `pricingFor` call sites with `resolvePrice`;
    delete the old `pricingFor` export. Update `tests/pricing.test.ts` assertions that
    referenced `pricingFor` directly (keep the `gpt-4` -> defined-row expectation,
    updated).
  - Gate: `tsc --noEmit` clean; existing render tests still pass after migration.

## Phase 2 — Single cost function + cache-aware + 1M tier

- [ ] T-2.1 — RED test: 1M-context surcharge
  - Agent: verify
  - Files: `tests/segments.test.ts` (extend)
  - Principles applied: §10.5 TDD
  - Patch (deterministic): assert `computeCost` with `contextWindowSize === 1000000`
    (or `exceeds_200k_tokens`) applies the surcharge multiplier to input/output;
    `200000` applies none. Test fails until T-2.2 done.
  - Gate: test RED.

- [ ] T-2.2 — Extract shared `computeCost`, delete duplicate in render.ts
  - Agent: build
  - Files: `src/segments.ts:143-164` (become `computeCost`), `src/render.ts:188-209`
    (delete duplicate; call `computeCost`), `src/segments.ts:130-141` (`CostInput`
    gains `contextWindowSize?` + `exceeds200k?`)
  - Principles applied: §10.4 DRY, §10.3 SOLID, §10.1 KISS
  - Patch (deterministic): move the token×price math into `computeCost(input, price)`
    (cache read/write already separate — keep); apply 1M-tier multiplier when
    `contextWindowSize === 1000000`; `render.ts` JSON path calls `computeCost` instead
    of inlining the formula. `costSegment` becomes a thin formatter over `computeCost`.
  - Gate: ANSI and JSON cost paths produce identical numbers (`computeCost` single
    source); existing `tests/render.test.ts` cost cases pass.

## Phase 3 — Recompute default + BYO

- [ ] T-3.1 — RED test: non-Anthropic ignores server cost
  - Agent: verify
  - Files: `tests/segments.test.ts` (extend)
  - Principles applied: §10.5 TDD
  - Patch (deterministic): assert that for a non-Anthropic `model.id` with a server
    `cost.total_cost_usd` present, the rendered cost uses `computeCost(current_usage.*)`
    from the live row and does NOT show the server number. Test fails until T-3.2.
  - Gate: test RED.

- [ ] T-3.2 — Recompute default; server cost fallback only
  - Agent: build
  - Files: `src/segments.ts:148-160`, `src/render.ts:188-209`, `src/costInput` builder
  - Principles applied: §10.1 KISS, §10.6 SDD
  - Patch (deterministic): `computeCost`/`costSegment` prefer `current_usage.*` ×
    live price; use `cost.total_cost_usd` only when `current_usage` is null; for
    non-Anthropic ids, never use the server cost. Update `CostInput` builder in
    `render.ts`.
  - Gate: GREEN on T-3.1; Anthropic model still agrees with `cost.total_cost_usd`
    within rounding.

## Phase 4 — Effort + context pressure + null handling

- [ ] T-4.1 — Effort segment (present -> show, absent -> hide)
  - Agent: build
  - Files: `src/segments.ts` (new `effortSegment`), `src/render.ts` (compose)
  - Principles applied: §10.7 Clean Code, §10.2 YAGNI
  - Patch (deterministic): `effortSegment(level, modelId)` renders `effort.level`
    verbatim when present; returns `""` when absent; no special-casing of literal
    `"ultracode"` (surfaces as `xhigh`); no dimming in v1. Treat non-Anthropic level as
    "requested" (documented, not visually flagged).
  - Gate: unit test — absent -> `""`; `xhigh` -> shown; open model with level -> shown,
    labeled requested internally.

- [ ] T-4.2 — Context-pressure indicator
  - Agent: build
  - Files: `src/segments.ts` (existing `largeContextSegment`), `src/render.ts`
  - Principles applied: §10.1 KISS
  - Patch (deterministic): derive the pressure badge from `used_percentage` /
    `exceeds_200k_tokens` and `context_window_size`; ensure it reflects 200k-vs-1M
    correctly. No new cost math.
  - Gate: unit test for 200k and 1M windows.

- [ ] T-4.3 — Null `current_usage` / `/clear` handling
  - Agent: build
  - Files: `src/render.ts` (payload -> segments), `src/segments.ts`
  - Principles applied: §10.7 Clean Code
  - Patch (deterministic): when `current_usage` is null (pre-first-call, post-
    `/compact`), cost/context segments render empty, never `NaN`/`undefined` garbage.
  - Gate: integration test feeding a `/clear` payload -> clean render.

## Phase 5 — Cleanup + docs

- [ ] T-5.1 — Fix stale Haiku comment
  - Agent: build
  - Files: `src/pricing.ts:15-16`
  - Principles applied: §10.7 Clean Code
  - Patch (deterministic): change "1.0x for Haiku" -> "1.25x for Haiku" (every Haiku
    row uses 1.25x; confirmed `src/pricing.ts:45,49,53,58`).
  - Gate: comment matches code; no behavior change.

- [ ] T-5.2 — Update README cost docs
  - Agent: build
  - Files: `README.md:132`
  - Principles applied: §10.7 Clean Code
  - Patch (deterministic): replace "tokens × Anthropic price for `model.id`" with
    multi-provider + live-source description; note OpenRouter (open/BYO) + models.dev
    (Claude) and the bundled fallback.
  - Gate: docs build/lint clean.

- [ ] T-5.3 — CHANGELOG migration entry
  - Agent: build
  - Files: `CHANGELOG.md` (top entry)
  - Principles applied: §10.7 Clean Code, CONSTITUTION §3
  - Patch (deterministic): document the behavior break — unknown models now show
    recomputed cost (or explicit "no price") instead of silently hiding; Anthropic
    prices now come from a live feed; no compat shim.
  - Gate: entry present; no suppression comments added.

## Phase 6 — Integration + verification

- [ ] T-6.1 — Integration test: open/BYO full render
  - Agent: verify
  - Files: `tests/render.test.ts` (extend)
  - Principles applied: §10.5 TDD
  - Patch (deterministic): feed a full statusline payload with `model.id =
    "openrouter/..."` + `current_usage.*`; assert cost segment renders the recomputed
    value, effort hidden (absent), context badge correct. Feed `gpt-4o` -> resolves to
    OpenRouter row.
  - Gate: test GREEN.

- [ ] T-6.2 — Quality gate
  - Agent: guard
  - Files: repo-wide
  - Principles applied: §10.8 Hexagonal (ports/adapters boundary clean)
  - Patch (deterministic): none.
  - Gate: `npm test` green; `ai-eng` governance gates (gitleaks/semgrep) clean;
    `spec-001` acceptance criteria checklist satisfied.

## Execution order (TDD pairs)

T-0.1 -> T-0.2 -> **T-0.3 (RED)** -> T-1.1 -> T-1.2 -> **T-2.1 (RED)** -> T-2.2 ->
**T-3.1 (RED)** -> T-3.2 -> T-4.1 -> T-4.2 -> T-4.3 -> T-5.1 -> T-5.2 -> T-5.3 ->
**T-6.1 (RED->GREEN)** -> T-6.2.

Every GREEN task is preceded by its RED test task. `resolvePrice` and `computeCost`
are the two single-concern seams `/ai-build` routes to the cheap tier; the new
`pricingSource.ts` fetch/cache logic is `mid` effort (synthesis required).
