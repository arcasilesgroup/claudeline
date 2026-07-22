---
spec: spec-002
title: "Context window resolution for open models"
status: in-progress
effort: small
summary: "Resolve context window sizes for open/BYO models from live sources (OpenRouter, models.dev, LiteLLM) so the context percentage segment renders accurate values instead of a hardcoded 200K fallback."
---

## Summary

The context percentage segment (`✍️ N%`) relies on `context_window_size` from Claude Code's stdin payload. For Anthropic models this is accurate — Claude Code knows its own context windows. For open/BYO models (OpenRouter, local, custom endpoints), Claude Code either omits `context_window_size` or sets it to null, causing a fallback to `DEFAULT_CONTEXT_WINDOW = 200_000` (`render.ts:91`). This produces incorrect percentages: a 128K-context Llama 3 model at 50K tokens shows 25% instead of the correct 39%. The same live sources that provide pricing (OpenRouter API, models.dev, LiteLLM) also carry context window metadata — but `pricingSource.ts` currently only fetches pricing, not context sizes.

## Goals

- Add `resolveContextWindow(modelId)` to `pricingSource.ts` — same module, same cache lifecycle, no new files.
- Fetch `context_length` from OpenRouter and `context_window` / `max_input_tokens` from models.dev and LiteLLM during `refreshPricingCache()`.
- Extend the bundled snapshot with context window seed rows for known open models (GPT-4o, Llama 3, Mistral, etc.).
- Update `buildContextInput()` in `render.ts` to resolve window size via: stdin → `resolveContextWindow()` → `DEFAULT_CONTEXT_WINDOW`.
- Preserve the existing fallback chain — stdin is always primary; live-resolved is secondary; 200K is terminal fallback.
- Existing Anthropic model behavior is unchanged (stdin always provides accurate `context_window_size`).

## Non-Goals

- Changing the cost calculation or long-context surcharge logic.
- Adding a separate `contextWindowSource.ts` module — the fix extends the existing pricing source.
- Supporting per-variant context windows (e.g., Llama 3 8B vs 70B have different windows) in v1 — fuzzy substring match is sufficient.
- Modifying the `contextSegment()` rendering logic — it already handles the percentage correctly once given the right window size.
- Fetching context windows from additional sources beyond the existing three (OpenRouter, models.dev, LiteLLM).

## Decisions

**D-002-01: Extend `pricingSource.ts` rather than create a new module.**
Rationale: Same three sources, same fetch-guard-fallback pattern, same cache file, same in-memory lifecycle. A separate module would duplicate the fetch infrastructure for ~20 lines of new logic. Single-responsibility is preserved — the module's job is "resolve model metadata from live sources," pricing and context windows are both model metadata.

**D-002-02: Bundle context window seed rows in `pricing.snapshot.json`.**
Rationale: The bundled snapshot is the offline fallback. Without seed rows, a fresh install with no network access shows 200K for every open model. Adding ~10 seed rows (GPT-4o, Llama 3, Mistral, Mixtral, Qwen, Gemma) costs negligible bytes and ensures the first render before `refreshPricingCache()` has accurate data for common models.

**D-002-03: Stdin remains primary; live-resolved window is secondary.**
Rationale: Claude Code's stdin is the most authoritative source for Anthropic models (it knows the exact context window including 1M variants). Live-resolved data fills the gap for open models. The `DEFAULT_CONTEXT_WINDOW` terminal fallback handles unknown/new models gracefully.

**D-002-04: Reuse the same fuzzy matching chain for context windows as pricing.**
Rationale: The exact-id → substring fallback already handles model ID variations (`llama3` matching `openrouter/meta-llama/llama-3-8b`). Context window resolution benefits from the same tolerance without extra logic.

**D-002-05: `resolveContextWindow()` returns `number | undefined`, not a default.**
Rationale: The caller (`buildContextInput`) owns the fallback chain. Returning `undefined` on miss lets the caller decide between live-resolved and `DEFAULT_CONTEXT_WINDOW`, keeping the resolution function pure and testable.

## Risks

**R-002-01: OpenRouter model IDs are inconsistent across versions.**
Mitigation: Fuzzy substring matching tolerates minor ID variations. Bundled seed rows cover the most common models. The terminal 200K fallback ensures graceful degradation for unrecognized IDs.

**R-002-02: LiteLLM context window data may be stale or inaccurate for very new models.**
Mitigation: LiteLLM is community-maintained and updated frequently. Stale data produces a slightly wrong percentage (not catastrophically wrong). The bundled seed provides a baseline for known models.

**R-002-03: Cache file grows with context window rows.**
Mitigation: Context window rows are one field per model (~20 bytes overhead). Even 1000 models add ~20KB — negligible compared to the pricing rows already cached.

## References

- pr: soydachi/claudeline#39 (pricing fidelity for open models + CC feature parity)
- doc: `src/pricingSource.ts` (live pricing source layer)
- doc: `src/render.ts:88-91` (DEFAULT_CONTEXT_WINDOW fallback)
- doc: `src/segments.ts:26-55` (ContextInput + contextSegment)
