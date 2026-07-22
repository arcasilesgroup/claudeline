---
title: "Claudeline: pricing fidelity for open models + Claude Code feature parity"
status: draft
audience: framework-dev
branch: draft/claudeline-pricing-cc-features
length_estimate: 360
authoring_style: technical
principles_required:
  - "§10.1 KISS"
  - "§10.2 YAGNI"
  - "§10.5 TDD"
  - "§10.6 SDD"
delivery_mode: spec.md
mantra: "Price the tokens the provider actually reported, not Anthropic's estimate."
---

# 1. Vision

Claudeline should stop being a hard-coded, Claude-only cost estimator and become a
multi-provider, source-of-truth cost tracker. Today it ships a static price table that
is **frozen for every vendor it lists** — including Anthropic — and trusts Claude
Code's `cost.total_cost_usd`, which is wrong for any open or BYO model routed through a
gateway. The target: price the token counts the running provider actually reports
(`context_window.current_usage.*`), looked up against a **single pollable registry
(OpenRouter) that returns Anthropic and open-model pricing in one call**, refreshed on
a cadence with keyless fallbacks, so spend stays faithful to the real bill regardless of
which model Claude Code is pointed at. The Anthropic rows are not special-cased — they
are just as stale as the missing open ones.

# 2. Scope Boundary

In scope:
- Replace the static price table with a loadable source (bundled snapshot + optional
  fetched registry), keyed by `model.id` with provider tagging. **Anthropic rows are
  sourced from the same live feed, not hand-maintained.**
- Cache-aware, 1M-context-tier-aware cost math as a single function (dedupe the two
  current copies).
- BYO / gateway model detection and correct per-provider pricing.
- Recompute-from-`current_usage` strategy as the default for cost display.
- Select Claude Code parity surfaces: surface `effort.level` (hide when absent, treat
  as "requested" for open/BYO), context-pressure indicators, and correct null handling
  on `/clear` and post-`/compact`.
- Clean up the stale Haiku cache-multiplier comment.

Explicitly NOT in scope:
- Building a gateway/proxy (that is external, e.g. `claude-code-provider-gateway` or
  OpenRouter itself).
- Re-estimating token counts across providers (tokenization differs per provider).
- Batch-workflow cost tracking.
- Serving or hosting local models (Ollama/LM Studio/llama.cpp integration itself).

# 3. Diagnostic Snapshot

Current state, every claim cited to `file:line`:

- **Prices are 100% hard-coded and frozen for every vendor.** The sole source of cost
  is a static in-memory array at `src/pricing.ts:20-77` (`const TABLE`), annotated
  "Sourced from Anthropic's published pricing ... as of late April 2026"
  (`src/pricing.ts:3-4`). There is no network call, remote JSON, build step, or CLI
  subcommand that refreshes these numbers; the table was introduced whole-cloth in
  commit `b8087b3` and never touched since. **Even Anthropic's own rows do not update** —
  any Anthropic price change since April 2026 is silently invisible to claudeline.
- **Resolver is substring-only and returns `undefined` for non-Anthropic ids.**
  `pricingFor` (`src/pricing.ts:79-86`) lower-cases `model.id` and does
  `id.includes(entry.match)`; order matters. Any id lacking `opus`/`sonnet`/`haiku`
  substrings falls through to `undefined`.
- **Non-Claude models render no cost segment.** This fall-through is an explicit,
  tested contract: `tests/pricing.test.ts:24-29` asserts `pricingFor("gpt-4")` is
  `undefined`, and `tests/render.test.ts:210-224` asserts the cost segment is hidden.
  So `gpt-4`, `llama3`, `gemini-*`, `deepseek-*`, `grok-*` all silently show no local
  cost unless Claude Code happens to populate `cost.total_cost_usd`.
- **Cost math is duplicated in two places.** `src/segments.ts:143-164` (`costSegment`,
  ANSI path) and `src/render.ts:195-208` (JSON path) carry the same formula. Both give
  server-reported `cost.total_cost_usd` priority when present and non-negative
  (`src/segments.ts:149-150`, `src/render.ts:188-193`).
- **No provider concept exists anywhere.** `src/schemas.ts:24-29` defines `model` as
  `{ id, display_name }` only — there is no `provider` field in the schema, and
  `grep -rn "provider" src/*.ts` returns zero matches.
- **The only outbound network call is rate-limit usage, not pricing.** `src/api.ts:5`
  points at `https://api.anthropic.com/api/oauth/usage`; `fetchUsage`
  (`src/api.ts:24-57`) returns `five_hour`/`seven_day`/`extra_usage` only
  (`src/schemas.ts:85-106`). It is easy to mistake this for a price fetch; it is not.
- **Stale/misleading comment.** `src/pricing.ts:15-16` claims Haiku's cache-write
  multiplier is `1.0x`, but every Haiku row (`src/pricing.ts:45,49,53,58`) actually
  uses `1.25x`. Comment and code disagree.
- **No 1M-context pricing tier.** `exceeds_200k_tokens` exists in the schema
  (`src/schemas.ts:80`) but is consumed only as a cosmetic "large context" badge
  (`largeContextSegment` in `src/segments.ts`); Anthropic's real 1M-context surcharge
  (Sonnet roughly 2x above 200K tokens) is never modeled in the local estimate.
- **Model identity arrives only via stdin.** `claudeline render` reads raw JSON from
  stdin (`src/cli.ts:768-771`), validates it (`src/cli.ts:286`), and passes
  `input.model?.id` straight into `pricingFor` (`src/render.ts:195,318`). There is no
  config file, env var, or CLI flag for model or provider.
- **`effort` is not rendered and is model-gated.** Claudeline has no effort segment
  today. Claude Code emits `effort.level` only when the current model supports the
  reasoning-effort parameter (code.claude.com/docs/en/statusline). For open/BYO models
  routed via OpenRouter the field is typically absent; even when forced via
  `ANTHROPIC_DEFAULT_<TIER>_MODEL_SUPPORTED_CAPABILITIES`, it is a client "requested"
  flag the backend may ignore. `ultracode` is reported as `xhigh`, never a literal
  `"ultracode"` — so it has no real effect on open models without a native
  reasoning-effort concept (code.claude.com/docs/en/model-config).

# 4. Architecture

Proposed structural change, module / surface boundaries:

- **Pricing source layer (new).** A loader that (1) ships a bundled snapshot (seeded
  from today's `TABLE`, now only a fallback), and (2) fetches **OpenRouter
  `GET /api/v1/models`** at runtime — keyless, edge-cached (~5 min TTL), returns
  `pricing.{prompt,completion,input_cache_read,input_cache_write,...}` as USD **per
  token** (multiply by 1e6 for $/1M) covering Anthropic + OpenAI + Google + Llama +
  Mistral + DeepSeek + xAI + community in one call. **DeepInfra `/v1/openai/models`
  and Novita `/v3/openai/models`** (both keyless) serve as redundant fallbacks if
  OpenRouter is unreachable. Key-gated providers (Together/Fireworks/Nebius) are
  opt-in only. On any fetch failure it fails safe to the bundled snapshot — never
  blocks render. **Caveat:** OpenRouter's price is the cheapest routed provider for
  that model; for first-party Anthropic billing it is a proxy, not the exact invoice.
  If direct-Anthropic fidelity matters, keep Anthropic's published rates as an override
  layer (Anthropic exposes no keyless price API).
- **Unified resolver (replaces `pricingFor`).** Exact-id map first, then a fuzzy
  fallback, then a gateway-aware provider switch. Removes the order-dependent
  substring fragility noted at `src/pricing.ts:9-13`.
- **Single cost-math function (dedupe).** One implementation (shared by ANSI and JSON
  paths) that is cache-aware (cache-read/write priced separately) and 1M-tier-aware
  (applies the surcharge when `context_window_size == 1000000` /
  `exceeds_200k_tokens`).
- **Recompute strategy (default).** Price `context_window.current_usage.*` token
  counters against the local table as the primary display. Keep
  `cost.total_cost_usd` only as a fallback when `current_usage` is `null` (pre-first
  call, post-`/compact`). For non-Anthropic models, ignore `cost.total_cost_usd`
  entirely (it prices against Anthropic rates and is wrong).
- **BYO / gateway detection.** Infer provider from `model.id` prefix (e.g.
  `openrouter/...`) or gateway discovery metadata, then switch to that provider's price
  row.
- **Effort segment (new).** Render `effort.level` only when present in the payload;
  hide entirely when absent. Treat a non-Anthropic model's level as "requested, not
  applied" (no special-casing of the literal `ultracode`; it surfaces as `xhigh`).

# 5. Evidence Catalog

| Claim | Citation |
|---|---|
| Static frozen price table (Anthropic included) | `src/pricing.ts:20-77`, `src/pricing.ts:3-4` |
| Substring resolver, `undefined` for non-Claude | `src/pricing.ts:79-86`, `tests/pricing.test.ts:24-29` |
| Unknown model hides cost segment | `tests/render.test.ts:210-224` |
| Cost math duplicated | `src/segments.ts:143-164`, `src/render.ts:195-208` |
| Server cost wins when present | `src/segments.ts:149-150`, `src/render.ts:188-193` |
| No provider field | `src/schemas.ts:24-29` |
| Only network call is rate-limit, not pricing | `src/api.ts:5,24-57`, `src/schemas.ts:85-106` |
| Stale Haiku comment | `src/pricing.ts:15-16` vs `src/pricing.ts:45,49,53,58` |
| No 1M-context tier | `src/schemas.ts:80`, `src/segments.ts` (badge only) |
| Model from stdin only | `src/cli.ts:768-771,286`, `src/render.ts:195,318` |
| `effort.level` absent when model lacks effort param | code.claude.com/docs/en/statusline, code.claude.com/docs/en/model-config |
| CC statusline exposes `current_usage.*` counters | code.claude.com/docs/en/statusline |
| `cost.total_cost_usd` is a local estimate, resets on `/clear` | code.claude.com/docs/en/costs, code.claude.com/docs/en/statusline |
| BYO via `ANTHROPIC_BASE_URL` gateway; `cost.total_cost_usd` unreliable | docs.litellm.ai, code.claude.com/docs/en/costs (LLM-gateway) |
| OpenRouter `/api/v1/models`: keyless, 338 models, $/token pricing | live probe 2026-07-21, https://openrouter.ai/api/v1/models |
| DeepInfra `/v1/openai/models`: keyless $/1M fallback | live probe 2026-07-21, https://api.deepinfra.com/v1/openai/models |
| Novita `/v3/openai/models`: keyless integer `÷10000` fallback | live probe 2026-07-21, https://api.novita.ai/v3/openai/models |
| Together key-gated (401); Groq no inline pricing | live probes 2026-07-21 |
| Tokenization differs per provider; price reported tokens | tensorzero.com/blog, hammadhaqqani.com/blog |

# 6. Roadmap

Milestones with acceptance gates:

- **M1 — Reproduce & pin current behavior.** Golden tests capturing today's
  fall-through (`gpt-4` -> no segment), server-cost priority, and the duplicate-math
  parity. Gate: all current tests still green; new characterization tests added.
- **M2 — Pollable price source + local cache.** Loader with bundled snapshot and
  **OpenRouter `GET /api/v1/models`** primary (keyless, ~5 min edge TTL, $/token ->
  $/1M), **DeepInfra + Novita** keyless fallbacks, cached locally, fails safe. Gate:
  offline render uses bundled snapshot; OpenRouter outage falls back to DeepInfra/Novita
  then bundled; fetch failure logs, does not throw.
- **M3 — Unified resolver + multi-provider + gateway detection.** Exact-id map,
  fuzzy fallback, provider switch. Gate: `openrouter/...`, `gpt-4o`, `gemini-*`,
  `llama3`, `deepseek-*` resolve to real rows; Claude rows unchanged.
- **M4 — Cache-aware, 1M-tier cost math, dedupe.** Single function. Gate: identical
  output for ANSI and JSON paths; 1M-tier surcharge applied when context is 1M.
- **M5 — Recompute-from-`current_usage` default.** Server cost becomes fallback.
  Gate: non-Anthropic model shows correct recomputed cost; server cost ignored for it.
- **M6 — CC parity surfaces.** Surface `effort.level` **only when present**, hidden
  when absent, marked "requested" for open/BYO; context pressure from
  `used_percentage`/`exceeds_200k_tokens`; null handling on `/clear` and post-`/compact`.
  Gate: no garbage when `current_usage` is null; effort never fabricated.
- **M7 — Cleanup & docs.** Fix stale Haiku comment (`src/pricing.ts:15-16`); update
  README cost section (`README.md:132`). Gate: comment matches code; docs reflect
  multi-provider + live source.

# 7. Definition of Done

- Cost for any Claude Code-supported model (Anthropic or open/BYO) is computed from
  that provider's real rate and the tokens the provider reported.
- **Anthropic prices are no longer hand-maintained** — they come from the same live
  OpenRouter feed as everything else, with a bundled fallback.
- Prices are refreshed from a pollable source on a documented cadence, with a bundled
  fallback that never blocks render.
- Local estimate and `cost.total_cost_usd` agree within rounding for Anthropic models;
  for non-Anthropic models the local recompute is authoritative and `total_cost_usd`
  is not shown.
- Cache read/write are priced as distinct line items; 1M-context surcharge applied.
- No duplicate cost-math code remains; one resolver, one formula.
- `effort.level` surfaced when present and hidden when absent; never fabricated;
  treated as "requested" for open/BYO.
- Context-pressure indicators present; null/`/clear` states handled without garbage.

# 8. Quality Stamps

- §10.1 KISS — one loader, one resolver, one formula; delete the duplicate (`src/render.ts:195-208`).
- §10.2 YAGNI — no gateway, no cross-provider token re-estimation, no batch tracking.
- §10.5 TDD — characterization tests in M1 before any change; regression tests per milestone.
- §10.6 SDD — this brief precedes and feeds `spec.md` (the 14-section shape is the contract).
- Honours CONSTITUTION.md §3 (hard rename/migration, no compat shims) and the
  Single-Source-of-Truth-per-datum rule from `docs/persistence-doctrine.md`.

# 9. Open Decisions

- **Primary price source (recommend OpenRouter).** `GET /api/v1/models` is keyless,
  edge-cached, returns Anthropic + open pricing in one call, and removes the need for
  any hand-kept Anthropic table. DeepInfra + Novita are keyless fallbacks. Confirm
  OpenRouter-as-default vs. a LiteLLM/models.dev primary (both also valid; OpenRouter
  was the user's explicit ask and is the broadest single endpoint).
- **First-party Anthropic fidelity.** OpenRouter's price is the cheapest routed
  provider — a proxy, not the exact invoice, for direct-Anthropic billing. Do we keep
  Anthropic's published rates as an override layer, or accept the OpenRouter proxy for
  all Anthropic models? (Recommend: accept the proxy for simplicity; revisit if a
  user with first-party billing complains.)
- **Poll cadence & offline fallback:** daily fetch with TTL cache (OpenRouter already
  edge-caches ~5 min)? How stale is acceptable before the bundled snapshot is the truth?
- **Server-cost role:** keep `cost.total_cost_usd` primary (today) or demote to
  fallback (recommended)?
- **Provider tagging for BYO:** `model.id` prefix heuristic (e.g. `openrouter/...`) vs.
  gateway-discovery flag (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`)? Heuristic is
  simpler; flag is more reliable when available.
- **Effort for open/BYO:** confirm the "present -> show, absent -> hide, treat as
  requested-not-applied" rule; decide whether to dim the level when `model.id` is
  clearly non-Anthropic (recommend: no dimming in v1, keep it simple).
- **Local-model pricing:** where do Ollama/LM Studio prices come from (often $0, but
  VRAM/host cost)? Defer or treat as free.

# 10. Migration

Per CONSTITUTION.md §3 — hard rename, no shims:

- `src/pricing.ts` `TABLE` constant becomes the **bundled seed snapshot** loaded by
  the new source layer; the inline `const` is removed, not wrapped.
- `pricingFor` (`src/pricing.ts:79-86`) is replaced by the unified resolver; callers
  (`src/render.ts:195,318`) update to the new signature.
- The duplicate formula at `src/render.ts:195-208` is deleted; both paths call the
  shared cost function.
- CHANGELOG documents the behavior break: unknown models now show a recomputed cost
  (or explicit "no price") instead of silently hiding; Anthropic prices now come from
  the live feed.

# 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Aggregator carries speculative/unreleased 2026 model entries | High | Medium | Verify each row's provenance; pin to bundled snapshot on mismatch; never trust a price without source |
| Network/offline at fetch time (incl. OpenRouter down) | Medium | High | Bundled fallback, then DeepInfra/Novita, then bundled; fetch failure logs and continues; render never blocks |
| OpenRouter price is proxy, not exact first-party invoice | High | Low | Accept proxy for all; optional Anthropic override layer if first-party billing needs exactness |
| Tokenization non-comparable across providers | High | Low | Price the reported `current_usage.*` tokens, never re-estimate from text; label any cross-provider projection as approximate |
| `cost.total_cost_usd` wrong for BYO | High | High | Ignore server cost for non-Anthropic models; recompute locally |
| `effort` shown for open model but backend ignores it | Medium | Low | Treat as "requested, not applied"; never imply effect; hide when absent |
| Breaking price change from upstream | Medium | Medium | CHANGELOG documents; no compat shim; bump bundled snapshot |
| Substring matcher silently mis-prices new Anthropic ids | Low | Medium | Exact-id map first (M3) removes order dependence |

# 12. References

- Claude Code statusline payload — https://code.claude.com/docs/en/statusline
- Claude Code model configuration (effort capabilities) — https://code.claude.com/docs/en/model-config
- Claude Code costs / billing — https://code.claude.com/docs/en/costs
- Anthropic pricing — https://platform.claude.com/docs/en/about-claude/pricing
- Non-Anthropic models via gateway — https://docs.litellm.ai/docs/tutorials/claude_non_anthropic_models
- Claude Code provider gateway — https://github.com/danielalves96/claude-code-provider-gateway
- OpenRouter models API (primary price source, keyless) — https://openrouter.ai/api/v1/models
- OpenRouter models API reference — https://openrouter.ai/docs/api/api-reference/models/get-models
- OpenRouter Claude Code integration — https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration
- DeepInfra models (keyless fallback, $/1M) — https://api.deepinfra.com/v1/openai/models
- Novita models (keyless fallback, integer `÷10000`) — https://api.novita.ai/v3/openai/models
- Together AI models (key-gated) — https://docs.together.ai/reference/models
- LiteLLM price map (alt source) — https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
- models.dev API (alt source) — https://models.dev/api.json
- LLM Cost Hub — https://llmcosthub.com/api/v1/pricing.json
- ai-pricing.fyi — https://ai-pricing.fyi/v1/prices/current
- aicostbudget — https://aicostbudget.github.io/ai-api-pricing-data/api/v1/prices.json
- Monitoring usage (OTel) — https://code.claude.com/docs/en/monitoring-usage
- Tokenizer differences — https://www.tensorzero.com/blog/stop-comparing-price-per-million-tokens-the-hidden-llm-api-costs

# 13. Glossary

- **BYO** — Bring Your Own model: pointing Claude Code at a non-Anthropic model via a
  gateway/proxy (`ANTHROPIC_BASE_URL`).
- **Gateway** — a proxy speaking the Anthropic Messages API that fronts OpenAI/Gemini/
  local models (OpenRouter, claude-code-provider-gateway); exposes them in Claude Code's
  `/model` picker.
- **`current_usage`** — statusline object with per-turn token counters
  (input/output/cache_creation_input/cache_read); `null` before first API call and
  after `/compact`.
- **`cost.total_cost_usd`** — Claude Code's client-side session cost estimate; an
  estimate that may differ from the real bill and resets on `/clear`.
- **Aggregator** — a community/maintainer-maintained pricing JSON (OpenRouter,
  DeepInfra, Novita, LiteLLM, models.dev) that claudeline can poll instead of an
  official (non-existent) first-party feed.
- **1M context tier** — extended 1M-token window where Anthropic applies a higher rate
  (Sonnet ~2x above 200K); `context_window_size == 1000000`.
- **`effort.level`** — Claude Code's reasoning-effort field (`low`/`medium`/`high`/
  `xhigh`/`max`); `ultracode` reports as `xhigh`; absent when the model lacks the
  effort parameter.

# 14. Acceptance

- [ ] Unknown/non-Anthropic model no longer silently hides; shows recomputed cost or
      explicit "no price".
- [ ] **Anthropic prices are sourced live (OpenRouter), not hand-maintained.**
- [ ] Prices load from a pollable source (OpenRouter primary, DeepInfra/Novita
      fallback) on a documented cadence; bundled fallback used when offline/fetch fails.
- [ ] `openrouter/...`, `gpt-4o`, `gemini-*`, `llama3`, `deepseek-*` resolve to real
      per-provider rows.
- [ ] Cache read/write priced as distinct line items; 1M-context surcharge applied when
      context is 1M.
- [ ] Local estimate == `cost.total_cost_usd` within rounding for Anthropic models.
- [ ] For non-Anthropic models, `cost.total_cost_usd` is not shown; local recompute is
      authoritative.
- [ ] Single cost-math function; no duplicate in `src/render.ts`.
- [ ] `effort.level` surfaced when present, hidden when absent, never fabricated;
      treated as "requested" for open/BYO.
- [ ] Context-pressure indicators present; null/`/clear` states handled without garbage.
- [ ] Stale Haiku comment fixed; README cost section updated for multi-provider + live
      source.
- [ ] CHANGELOG documents the migration break (no compat shim).
