---
spec: spec-001
slug: claudeline-pricing-cc-features
title: "Claudeline: pricing fidelity for open models + Claude Code feature parity"
status: approved
audience: framework-dev
branch: draft/claudeline-pricing-cc-features
source_brief: .ai-engineering/specs/drafts/claudeline-pricing-fidelity-cc-features-brief.md
principles_required:
  - "§10.1 KISS"
  - "§10.2 YAGNI"
  - "§10.5 TDD"
  - "§10.6 SDD"
delivery_mode: plan
mantra: "Price the tokens the provider actually reported, not Anthropic's estimate."
---

# Claudeline: pricing fidelity for open models + Claude Code feature parity

## Summary

Claudeline today ships a static, Claude-only price table (`src/pricing.ts:20-77`) that
is **frozen for every vendor it lists — including Anthropic** (annotated "as of late
April 2026", `src/pricing.ts:3-4`) and trusts Claude Code's `cost.total_cost_usd`,
which is wrong for any open or BYO model routed through a gateway. The result: non-
Anthropic models render no cost segment at all (`tests/render.test.ts:210-224`), and
even Anthropic pricing has not tracked real changes since April 2026.

This spec makes claudeline a multi-provider, source-of-truth cost tracker. Cost is
recomputed from the token counts the running provider actually reports
(`context_window.current_usage.*`) against a **live price registry**, sourced from two
feeds: **OpenRouter** for open/BYO models and a **separate live Anthropic source**
(models.dev / LiteLLM) for Claude models on direct billing — so spend is faithful to
the real bill on both paths. The statusline also gains parity surfaces (effort, context
pressure, null/`/clear` handling).

## Goals

- Replace the static `TABLE` with a loadable price source: a bundled snapshot plus a
  runtime fetch, with OpenRouter for open/BYO and a live Anthropic source for Claude
  models.
- Recompute cost from `context_window.current_usage.*` token counters as the primary
  display; keep `cost.total_cost_usd` only as a fallback.
- Resolve pricing per `model.id` across Anthropic, OpenAI, Google, Llama, Mistral,
  DeepSeek, xAI, and community models — no more silent "no cost" for unknown ids.
- Price cache read/write as distinct line items and apply the 1M-context surcharge when
  `context_window_size == 1000000`.
- De-duplicate the cost-math logic into a single function shared by the ANSI and JSON
  render paths.
- Surface `effort.level` (only when present), context-pressure indicators, and handle
  null `current_usage` on `/clear` and post-`/compact` without garbage.
- Fix the stale Haiku cache-multiplier comment and update the README cost docs.

## Non-Goals

- Building a gateway/proxy (OpenRouter, claude-code-provider-gateway, or otherwise).
- Re-estimating token counts across providers (tokenization differs per provider; we
  price the reported tokens only).
- Batch-workflow cost tracking.
- Serving or hosting local models (Ollama/LM Studio/llama.cpp) — only pricing them.
- A configuration UI for choosing providers/keys in v1.

## Decisions

1. **Two separate live price sources (resolved by operator).** OpenRouter
   `GET /api/v1/models` (keyless, edge-cached ~5 min, USD per token -> x1e6 for $/1M)
   is the source for **open/BYO** models. A **separate live Anthropic source**
   (models.dev `api.json` primary, LiteLLM `model_prices_and_context_window.json`
   fallback — both keyless) is the source for **Claude models on direct billing**, so
   the Anthropic subscription/Console bill is exact, not a proxy. The bundled snapshot
   is the ultimate fallback for both. *Rationale:* the operator's core requirement is
   fidelity to the real bill; OpenRouter's price is exact for OpenRouter-routed traffic
   but a proxy for first-party Anthropic billing.*
2. **models.dev is the primary Anthropic source.** Clean per-1M schema with provenance
   fields; LiteLLM is the keyless fallback. (Both also cover many open models, so they
   can cover gaps if OpenRouter is unreachable.)
3. **Recompute-from-`current_usage` is the default.** `cost.total_cost_usd` is demoted
   to a fallback used only when `current_usage` is `null` (pre-first-call, post-
   `/compact`). For non-Anthropic models, `cost.total_cost_usd` is ignored entirely
   (it prices against Anthropic rates and is wrong).
4. **Provider tagging via `model.id` prefix heuristic**, e.g. `openrouter/...`, with
   the gateway-discovery flag (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`) used when
   available. No new config file or env var in v1.
5. **Poll cadence:** fetch on startup + periodically (daily default) into a local cache
   file; OpenRouter's own edge cache (~5 min TTL) is respected. Any fetch failure logs
   and falls back (OpenRouter -> models.dev/LiteLLM -> bundled) — render never blocks.
6. **Effort segment:** render `effort.level` **only when present**; hide entirely when
   absent. Treat a non-Anthropic model's level as "requested, not applied" — no
   special-casing of the literal `ultracode` (it surfaces as `xhigh`); no dimming in
   v1.
7. **Local-model pricing:** treat as free in v1 (price `0` or explicit "local"); defer
   VRAM/host-cost modeling.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Aggregator carries speculative/unreleased 2026 model entries | High | Medium | Verify each row's provenance; pin to bundled snapshot on mismatch; never trust a price without source |
| Network/offline at fetch time (incl. OpenRouter down) | Medium | High | Bundled -> models.dev/LiteLLM -> bundled fallback chain; fetch failure logs and continues; render never blocks |
| OpenRouter price is a proxy, not the exact first-party invoice | High (for direct Anthropic) | Low | Resolved by Decision 1: direct Anthropic billing uses the separate Anthropic live source, not OpenRouter |
| Tokenization non-comparable across providers | High | Low | Price the reported `current_usage.*` tokens, never re-estimate from text |
| `cost.total_cost_usd` wrong for BYO | High | High | Ignore server cost for non-Anthropic models; recompute locally |
| `effort` shown for open model but backend ignores it | Medium | Low | Treat as "requested, not applied"; hide when absent |
| Breaking price change from upstream | Medium | Medium | CHANGELOG documents; no compat shim; bump bundled snapshot |
| Substring matcher silently mis-prices new Anthropic ids | Low | Medium | Exact-id map first, then fuzzy fallback (removes order dependence) |

## What Changes (capabilities, not implementation)

- **Pricing source layer (new).** Loads a bundled snapshot and fetches live prices;
  selects the source by provider (OpenRouter for open/BYO, models.dev/LiteLLM for
  Claude). Exposes a single `priceFor(modelId)` lookup.
- **Unified resolver (replaces `pricingFor`, `src/pricing.ts:79-86`).** Exact-id map
  first, then fuzzy fallback, then provider switch.
- **Single cost function (dedupes `src/segments.ts:143-164` and
  `src/render.ts:195-208`).** Cache-aware and 1M-tier-aware; shared by both render
  paths.
- **Recompute default.** `current_usage.*` x live price is the primary cost; server
  cost is fallback.
- **BYO / gateway detection** from `model.id` prefix / discovery flag.
- **Effort segment (new).** Present -> show, absent -> hide.
- **Context-pressure indicators** from `used_percentage` / `exceeds_200k_tokens`.
- **Null/`/clear` handling** so no garbage renders when `current_usage` is null.
- **Cleanup:** fix stale Haiku comment (`src/pricing.ts:15-16`); update README
  (`README.md:132`).

## Acceptance Criteria

- [ ] Unknown/non-Anthropic model no longer silently hides; shows recomputed cost or
      explicit "no price".
- [ ] **Anthropic prices are sourced live (models.dev/LiteLLM), not hand-maintained;
      OpenRouter is used for open/BYO models.**
- [ ] Prices load from pollable sources on a documented cadence; bundled fallback used
      when offline/fetch fails; render never blocks.
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

## References

- Source brief — `.ai-engineering/specs/drafts/claudeline-pricing-fidelity-cc-features-brief.md`
- Claude Code statusline payload — https://code.claude.com/docs/en/statusline
- Claude Code model configuration (effort capabilities) — https://code.claude.com/docs/en/model-config
- Claude Code costs / billing — https://code.claude.com/docs/en/costs
- OpenRouter models API (open/BYO price source, keyless) — https://openrouter.ai/api/v1/models
- models.dev API (Anthropic live source, keyless) — https://models.dev/api.json
- LiteLLM price map (Anthropic fallback, keyless) — https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
- DeepInfra models (keyless fallback) — https://api.deepinfra.com/v1/openai/models
- Novita models (keyless fallback) — https://api.novita.ai/v3/openai/models
- Non-Anthropic models via gateway — https://docs.litellm.ai/docs/tutorials/claude_non_anthropic_models
- Tokenizer differences — https://www.tensorzero.com/blog/stop-comparing-price-per-million-tokens-the-hidden-llm-api-costs
