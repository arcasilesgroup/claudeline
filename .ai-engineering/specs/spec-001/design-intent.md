# Design Intent — spec-001 (claudeline-pricing-cc-features)

## Design

Problem (restated from `spec.md`): claudeline ships a static, Claude-only price
table (`src/pricing.ts:20-77`), has no live price source, no multi-provider
resolution, a duplicated cost formula (`src/segments.ts:143-164` and
`src/render.ts:188-209`), a stale Haiku comment (`src/pricing.ts:15-16`), and no
`effort`/context-parity surfaces. Non-Anthropic models render no cost at all
(`tests/render.test.ts:210-224`), and even Anthropic pricing is frozen at April 2026.

Approach (WHAT, per `spec.md` Decisions 1-7):
- **Pricing source layer (new).** A bundled snapshot (seeded from today's `TABLE`,
  hard-moved not wrapped) plus runtime fetches: **OpenRouter** `GET /api/v1/models`
  for open/BYO, **models.dev** `api.json` for Claude on direct billing (LiteLLM as
  keyless fallback for both). Fetched into a local cache; fallback chain
  OpenRouter → models.dev/LiteLLM → bundled; render never blocks.
- **Unified resolver.** Exact-id map → fuzzy fallback → provider switch (replaces
  substring-only `pricingFor`, `src/pricing.ts:79-86`).
- **Single cost function.** Cache-aware (read/write priced separately) and 1M-tier-
  aware; shared by ANSI and JSON paths (dedupes `src/render.ts:188-209`).
- **Recompute default.** `current_usage.*` × live price is primary; server
  `cost.total_cost_usd` is fallback (only when `current_usage` is null); ignored
  entirely for non-Anthropic models.
- **BYO detection** via `model.id` prefix (`openrouter/...`) + gateway-discovery flag.
- **Parity surfaces:** `effort.level` only when present; context-pressure from
  `used_percentage`/`exceeds_200k_tokens`; null/`/clear` handled without garbage.

## Architecture

Pattern: **Pluggable Source + Resolver** — a single new module owns data loading and
resolution; NOT a full strategy-factory (KISS / §10.1). No new config file or env var
in v1 (Decisions 4-5).

Module boundaries:
- `src/pricingSource.ts` (NEW) — owns the bundled snapshot, live fetch + cache, the
  fallback chain, and `resolvePrice(modelId)`. The single source of price truth.
- `src/segments.ts` — owns the single `computeCost(input, price)` (cache-aware, 1M-
  tier-aware) and the render segments including the new `effort`/`context` segments.
- `src/render.ts` — orchestration/format only; deletes its duplicate formula and calls
  `resolvePrice` + `computeCost`.

Data flow:
```
stdin payload
  → model.id
  → resolvePrice(modelId)            // provider tag → source → row (fallback chain)
  → computeCost(current_usage.*, price)   // cache-aware, 1M-tier
  → cost segment
server cost.total_cost_usd  → used ONLY as fallback when current_usage is null
```

Boundaries honored: provider tagging is heuristic (`openrouter/` prefix) + optional
gateway-discovery flag; no cross-provider token re-estimation (we price reported
tokens only); local models priced `0`/free in v1.
