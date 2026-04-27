import type { ModelPricing } from "./segments.js";

// USD per 1 million tokens. Sourced from Anthropic's published pricing
// (https://www.anthropic.com/pricing) as of late April 2026. The
// matcher is substring-based on the lower-cased model id so that both
// version-specific ids ("claude-opus-4-7-20260101") and shorter aliases
// ("claude-opus-4-7", "opus[1m]", "Opus 4.7") resolve to the same row.
//
// IMPORTANT — order matters. The first substring match wins, so put
// version-specific entries (`opus-4`) BEFORE generic aliases (`opus`).
// A generic alias placed first would swallow newer model ids and
// silently misprice them. The Haiku 3.5 row also has to come before
// the `haiku` catch-all because Haiku 3.5 is cheaper than 4.x.
//
// `cacheCreation` covers ephemeral 5-minute cache writes (1.25x input
// for Sonnet/Opus, 1.0x for Haiku). `cacheRead` is the cached-read
// price (10% of input). The catch-all aliases at the bottom exist
// purely for `display_name` fallback (e.g. "Opus 4.7") — when
// `model.id` is absent.
const TABLE: { match: string; pricing: ModelPricing }[] = [
  // Opus 4.x
  {
    match: "opus-4",
    pricing: { input: 15, cacheCreation: 18.75, cacheRead: 1.5, output: 75 },
  },
  // Opus 3.x
  {
    match: "opus-3",
    pricing: { input: 15, cacheCreation: 18.75, cacheRead: 1.5, output: 75 },
  },
  // Sonnet 4.x
  {
    match: "sonnet-4",
    pricing: { input: 3, cacheCreation: 3.75, cacheRead: 0.3, output: 15 },
  },
  // Sonnet 3.5 / 3.7 (currently same as 4.x; kept distinct so a future
  // discount diverges cleanly).
  {
    match: "sonnet-3",
    pricing: { input: 3, cacheCreation: 3.75, cacheRead: 0.3, output: 15 },
  },
  // Haiku 3.5 — cheaper than 4.x, MUST appear before the haiku catch-all.
  {
    match: "haiku-3-5",
    pricing: { input: 0.8, cacheCreation: 1, cacheRead: 0.08, output: 4 },
  },
  {
    match: "haiku-3.5",
    pricing: { input: 0.8, cacheCreation: 1, cacheRead: 0.08, output: 4 },
  },
  {
    match: "haiku 3.5",
    pricing: { input: 0.8, cacheCreation: 1, cacheRead: 0.08, output: 4 },
  },
  // Haiku 4.x
  {
    match: "haiku-4",
    pricing: { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 },
  },
  // Display-name catch-alls (`Opus 4.7`, `Sonnet 4.6`, `Haiku 4.5`).
  // Last-resort. Their pricing matches the latest version of each family,
  // which is the safest default if Anthropic ships a new id we haven't
  // tabled yet. Removing these entries would silently break cost lookup
  // for users on Claude Code releases that omit `model.id`.
  {
    match: "opus",
    pricing: { input: 15, cacheCreation: 18.75, cacheRead: 1.5, output: 75 },
  },
  {
    match: "sonnet",
    pricing: { input: 3, cacheCreation: 3.75, cacheRead: 0.3, output: 15 },
  },
  {
    match: "haiku",
    pricing: { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 },
  },
];

export function pricingFor(modelId: string | null | undefined): ModelPricing | undefined {
  if (!modelId) return undefined;
  const id = modelId.toLowerCase();
  for (const entry of TABLE) {
    if (id.includes(entry.match)) return entry.pricing;
  }
  return undefined;
}
