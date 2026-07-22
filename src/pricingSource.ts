import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import snapshot from "./pricing.snapshot.json" with { type: "json" };
import type { ModelPricing } from "./segments.js";

// The single source of price truth (spec-001 sub-001). This module owns the
// bundled snapshot, the live-fetch refresh, the local cache, and the
// `resolvePrice` resolver. `resolvePrice` is synchronous over an already
// loaded in-memory table so the render hot path NEVER blocks on the network.

/** Which billing surface a model is priced against. */
export type PriceProvider = "anthropic" | "openrouter";

/** How the id matched a table row: exact id vs. substring alias. */
export type PriceMatchType = "exact" | "fuzzy";

export interface ResolvedPrice {
  pricing: ModelPricing;
  provider: PriceProvider;
  matchType: PriceMatchType;
}

interface PriceRow {
  match: string;
  pricing: ModelPricing;
}

// Bundled seed — always present, the terminal fallback of the chain. Live
// sources merge *in front of* these rows; the bundled rows can never be
// evicted, so resolution keeps working fully offline.
const BUNDLED: readonly PriceRow[] = snapshot.table;

// In-memory table used by `resolvePrice`. Starts as the bundled seed and is
// replaced (never emptied) by `loadPricingCache` / `refreshPricingCache`.
let cache: readonly PriceRow[] = BUNDLED;

function defaultCachePath(): string {
  return join(homedir(), ".claudeline", "price-cache.json");
}

// Provider is a heuristic over the raw id: an `openrouter/` prefix or any
// non-Claude id is treated as OpenRouter/BYO; `claude-*` and `anthropic/*`
// are Anthropic direct-billing. No token re-estimation across providers.
function providerFor(id: string): PriceProvider {
  const lower = id.toLowerCase();
  if (lower.startsWith("openrouter/")) return "openrouter";
  if (lower.startsWith("claude") || lower.startsWith("anthropic")) {
    return "anthropic";
  }
  return "openrouter";
}

/**
 * Resolve a model id to its price row, provider tag, and match type.
 * Exact-id map first, then substring (fuzzy) fallback — mirroring the
 * order-sensitive semantics of the legacy `pricingFor`. Returns `undefined`
 * when nothing matches.
 */
export function resolvePrice(
  modelId: string | null | undefined,
): ResolvedPrice | undefined {
  if (!modelId) return undefined;
  const id = modelId.toLowerCase();

  const exact = cache.find((row) => row.match === id);
  if (exact) {
    return {
      pricing: exact.pricing,
      provider: providerFor(id),
      matchType: "exact",
    };
  }

  const fuzzy = cache.find((row) => id.includes(row.match));
  if (fuzzy) {
    return {
      pricing: fuzzy.pricing,
      provider: providerFor(id),
      matchType: "fuzzy",
    };
  }

  return undefined;
}

/**
 * Load a previously written price cache into memory. Reads the local cache
 * file if present and merges its rows in front of the bundled seed. Never
 * throws — on any error it logs and retains the bundled table so render is
 * never left without prices.
 */
export async function loadPricingCache(
  cachePath: string = defaultCachePath(),
): Promise<void> {
  try {
    if (!existsSync(cachePath)) return;
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
      table?: PriceRow[];
    };
    if (Array.isArray(parsed.table) && parsed.table.length > 0) {
      cache = [...parsed.table, ...BUNDLED];
    }
  } catch (err) {
    console.error(
      `claudeline: failed to load price cache (${String(err)}); using bundled snapshot`,
    );
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// OpenRouter — open/BYO source. `pricing.prompt`/`pricing.completion` are
// strings in USD *per token*; multiply by 1e6 for $/1M. No cache-tier split.
async function fetchOpenRouter(): Promise<PriceRow[]> {
  const body = (await fetchJson("https://openrouter.ai/api/v1/models")) as {
    data?: Array<{
      id?: string;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };
  const rows: PriceRow[] = [];
  for (const model of body.data ?? []) {
    if (!model.id) continue;
    rows.push({
      match: model.id.toLowerCase(),
      pricing: {
        input: Number(model.pricing?.prompt ?? 0) * 1e6,
        cacheCreation: 0,
        cacheRead: 0,
        output: Number(model.pricing?.completion ?? 0) * 1e6,
      },
    });
  }
  return rows;
}

// models.dev — Claude direct-billing source. `cost.*` values are already
// $/1M; map cache_write -> cacheCreation, cache_read -> cacheRead.
async function fetchModelsDev(): Promise<PriceRow[]> {
  const body = (await fetchJson("https://models.dev/api.json")) as Record<
    string,
    {
      models?: Record<
        string,
        {
          cost?: {
            input?: number;
            output?: number;
            cache_read?: number;
            cache_write?: number;
          };
        }
      >;
    }
  >;
  const rows: PriceRow[] = [];
  for (const provider of Object.values(body)) {
    for (const [id, model] of Object.entries(provider.models ?? {})) {
      const cost = model.cost;
      if (!cost) continue;
      rows.push({
        match: id.toLowerCase(),
        pricing: {
          input: cost.input ?? 0,
          cacheCreation: cost.cache_write ?? 0,
          cacheRead: cost.cache_read ?? 0,
          output: cost.output ?? 0,
        },
      });
    }
  }
  return rows;
}

// LiteLLM — keyless fallback for both paths. All `*_cost_per_token` fields
// are USD *per token*; multiply by 1e6 for $/1M.
async function fetchLiteLLM(): Promise<PriceRow[]> {
  const body = (await fetchJson(
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  )) as Record<
    string,
    {
      input_cost_per_token?: number;
      output_cost_per_token?: number;
      cache_read_input_token_cost?: number;
      cache_creation_input_token_cost?: number;
    }
  >;
  const rows: PriceRow[] = [];
  for (const [id, model] of Object.entries(body)) {
    if (typeof model !== "object" || model === null) continue;
    if (
      model.input_cost_per_token === undefined &&
      model.output_cost_per_token === undefined
    ) {
      continue;
    }
    rows.push({
      match: id.toLowerCase(),
      pricing: {
        input: (model.input_cost_per_token ?? 0) * 1e6,
        cacheCreation: (model.cache_creation_input_token_cost ?? 0) * 1e6,
        cacheRead: (model.cache_read_input_token_cost ?? 0) * 1e6,
        output: (model.output_cost_per_token ?? 0) * 1e6,
      },
    });
  }
  return rows;
}

/**
 * Refresh the price cache from the live sources. Tries OpenRouter ->
 * models.dev -> LiteLLM in order; each source is independently guarded so a
 * failure logs and falls through to the next. Successful rows are merged in
 * front of the bundled seed (which is always retained), the merged table is
 * written to the cache file, and the in-memory table is updated. Never
 * throws — on total failure the bundled snapshot is retained.
 */
export async function refreshPricingCache(
  cachePath: string = defaultCachePath(),
): Promise<void> {
  const sources: ReadonlyArray<readonly [string, () => Promise<PriceRow[]>]> = [
    ["openrouter", fetchOpenRouter],
    ["models.dev", fetchModelsDev],
    ["litellm", fetchLiteLLM],
  ];

  const fetched: PriceRow[] = [];
  for (const [name, fetchSource] of sources) {
    try {
      fetched.push(...(await fetchSource()));
    } catch (err) {
      console.error(
        `claudeline: price source "${name}" unavailable (${String(err)}); trying next`,
      );
    }
  }

  // Fetched rows take precedence; the bundled seed is always the fallback.
  const merged: PriceRow[] = [...fetched, ...BUNDLED];
  cache = merged;

  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify(
        {
          version: snapshot.version,
          generatedAt: new Date().toISOString(),
          table: merged,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (err) {
    console.error(
      `claudeline: failed to write price cache (${String(err)}); keeping in-memory table`,
    );
  }
}
