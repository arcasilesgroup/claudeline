import type { ModelPricing } from "./segments.js";
import snapshot from "./pricing.snapshot.json" with { type: "json" };

// Price data now lives in the bundled snapshot `pricing.snapshot.json`
// (the seed for the live pricing source layer, spec-001 sub-001). This
// module is a thin substring reader over that snapshot; the price rows
// were hard-moved out of here, not wrapped.
//
// The matcher is substring-based on the lower-cased model id so that both
// version-specific ids ("claude-opus-4-7-20260101") and shorter aliases
// ("claude-opus-4-7", "opus[1m]", "Opus 4.7") resolve to the same row.
//
// IMPORTANT — order matters. The first substring match wins, so the
// snapshot keeps version-specific entries (`opus-4`) BEFORE generic
// aliases (`opus`). A generic alias placed first would swallow newer
// model ids and silently misprice them. The Haiku 3.5 rows also come
// before the `haiku` catch-all because Haiku 3.5 is cheaper than 4.x.
//
// `cacheCreation` covers ephemeral 5-minute cache writes, priced at
// 1.25x input for every current family (Sonnet, Opus, and Haiku — each
// row in the snapshot is 1.25x its own input). `cacheRead` is the
// cached-read price (10% of input). The catch-all aliases at the bottom
// of the snapshot exist purely for `display_name` fallback (e.g.
// "Opus 4.7") when `model.id` is absent.
const TABLE: readonly { match: string; pricing: ModelPricing }[] =
  snapshot.table;

export function pricingFor(
  modelId: string | null | undefined,
): ModelPricing | undefined {
  if (!modelId) return undefined;
  const id = modelId.toLowerCase();
  for (const entry of TABLE) {
    if (id.includes(entry.match)) return entry.pricing;
  }
  return undefined;
}
