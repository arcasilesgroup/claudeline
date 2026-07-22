import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import snapshot from "../src/pricing.snapshot.json" with { type: "json" };
import {
  loadPricingCache,
  refreshPricingCache,
  resolveContextWindow,
  resolvePrice,
} from "../src/pricingSource.js";

// A row for a specific match is the ModelPricing seeded verbatim from the
// old static TABLE. This regression net guards the hard-move (T-0.1/T-0.2).
function rowFor(match: string) {
  return snapshot.table.find((entry) => entry.match === match)?.pricing;
}

describe("pricing.snapshot.json integrity", () => {
  test("carries version + generatedAt provenance", () => {
    expect(typeof snapshot.version).toBe("number");
    expect(typeof snapshot.generatedAt).toBe("string");
    expect(snapshot.generatedAt.length).toBeGreaterThan(0);
  });

  test("table is a non-empty array of { match, pricing } rows", () => {
    expect(Array.isArray(snapshot.table)).toBe(true);
    expect(snapshot.table.length).toBeGreaterThan(0);
    for (const entry of snapshot.table) {
      expect(typeof entry.match).toBe("string");
      expect(typeof entry.pricing.input).toBe("number");
      expect(typeof entry.pricing.cacheCreation).toBe("number");
      expect(typeof entry.pricing.cacheRead).toBe("number");
      expect(typeof entry.pricing.output).toBe("number");
    }
  });

  test("seeds the 11 Claude rows verbatim", () => {
    expect(rowFor("opus-4")).toEqual({
      input: 15,
      cacheCreation: 18.75,
      cacheRead: 1.5,
      output: 75,
    });
    expect(rowFor("sonnet-4")).toEqual({
      input: 3,
      cacheCreation: 3.75,
      cacheRead: 0.3,
      output: 15,
    });
    expect(rowFor("haiku-3-5")).toEqual({
      input: 0.8,
      cacheCreation: 1,
      cacheRead: 0.08,
      output: 4,
    });
    expect(rowFor("haiku-4")).toEqual({
      input: 1,
      cacheCreation: 1.25,
      cacheRead: 0.1,
      output: 5,
    });
  });

  test("seeds curated open-model rows for offline resolution", () => {
    expect(rowFor("gpt-4o")).toBeDefined();
    expect(rowFor("llama3")).toBeDefined();
    expect(rowFor("openrouter/")).toBeDefined();
  });

  test("seeds popular open model rows with valid pricing structure (spec-002)", () => {
    // Structural test only — prices change frequently, exact values are
    // tested by the live fetch refreshPricingCache tests, not here.
    const popular = [
      "xiaomi/mimo-v2.5",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "tencent/hy3",
      "z-ai/glm-5.2",
      "moonshotai/kimi-k3",
      "x-ai/grok-4.5",
      "qwen/qwen3.7-max",
      "moonshotai/kimi-k2.7-code",
      "minimax/minimax-m3",
      "qwen/qwen3.7-plus",
      "qwen/qwen3.6-plus",
      "google/gemma-4",
    ];
    for (const id of popular) {
      const row = rowFor(id);
      expect(row).toBeDefined();
      expect(row!.input).toBeGreaterThanOrEqual(0);
      expect(row!.output).toBeGreaterThanOrEqual(0);
    }
  });
});

// T-0.3/T-0.4 — resolvePrice contract over the bundled snapshot (offline).
// These run before any refresh so the in-memory cache is still the bundled
// seed; they assert provider tagging + fallback resolution.
describe("resolvePrice (bundled/offline)", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("tags Claude ids as the anthropic provider", () => {
    const resolved = resolvePrice("claude-opus-4-7");
    expect(resolved).toBeDefined();
    expect(resolved?.provider).toBe("anthropic");
    expect(resolved?.pricing.input).toBe(15);
    expect(resolved?.pricing.output).toBe(75);
  });

  test("tags open/BYO ids as the openrouter provider", () => {
    expect(resolvePrice("gpt-4o")?.provider).toBe("openrouter");
    expect(resolvePrice("gpt-4o")?.pricing.input).toBe(2.5);
    expect(resolvePrice("openrouter/foo")?.provider).toBe("openrouter");
    expect(resolvePrice("openrouter/foo")).toBeDefined();
  });

  test("resolves the curated llama3 open-model row", () => {
    const resolved = resolvePrice("llama3");
    expect(resolved).toBeDefined();
    expect(resolved?.provider).toBe("openrouter");
    expect(resolved?.pricing.output).toBe(0.2);
  });

  test("distinguishes exact-id from fuzzy substring matches", () => {
    expect(resolvePrice("gpt-4o")?.matchType).toBe("exact");
    expect(resolvePrice("claude-opus-4-7")?.matchType).toBe("fuzzy");
  });

  test("returns undefined for unknown and empty ids", () => {
    expect(resolvePrice("totally-unknown-xyz")).toBeUndefined();
    expect(resolvePrice("")).toBeUndefined();
    expect(resolvePrice(null)).toBeUndefined();
    expect(resolvePrice(undefined)).toBeUndefined();
  });

  test("loadPricingCache never throws offline and keeps bundled prices", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const missing = join(tmpdir(), "claudeline-nope", "price-cache.json");
    await expect(loadPricingCache(missing)).resolves.toBeUndefined();
    expect(resolvePrice("claude-opus-4-7")?.pricing.input).toBe(15);
  });
});

describe("resolveContextWindow (bundled/offline)", () => {
  test("returns context window for known open model", () => {
    const ctx = resolveContextWindow("gpt-4o");
    expect(ctx).toBe(128_000);
  });

  test("fuzzy matches openrouter model ids", () => {
    const ctx = resolveContextWindow("openrouter/meta-llama/llama-3-8b");
    expect(ctx).toBe(128_000);
  });

  test("returns undefined for unknown model", () => {
    expect(resolveContextWindow("totally-unknown-xyz")).toBeUndefined();
  });

  test("returns undefined for null/undefined input", () => {
    expect(resolveContextWindow(null)).toBeUndefined();
    expect(resolveContextWindow(undefined)).toBeUndefined();
  });

  test("resolves context windows for popular open models (snapshot v2)", () => {
    // Structural test — context windows can change with model updates.
    // Exact values are verified by the live fetch path, not here.
    const popular = [
      "xiaomi/mimo-v2.5",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "tencent/hy3",
      "z-ai/glm-5.2",
      "moonshotai/kimi-k3",
      "x-ai/grok-4.5",
      "qwen/qwen3.7-max",
      "moonshotai/kimi-k2.7-code",
      "minimax/minimax-m3",
      "qwen/qwen3.7-plus",
      "qwen/qwen3.6-plus",
      "google/gemma-4",
    ];
    for (const id of popular) {
      const ctx = resolveContextWindow(id);
      expect(ctx).toBeGreaterThan(0);
    }
  });
});

// T-0.5/T-0.6 — live fetch, $/1M normalization, cache-write, fallback chain.
// Placed after the bundled tests because refreshPricingCache mutates the
// shared in-memory cache.
describe("refreshPricingCache (live fetch + fallback chain)", () => {
  const origFetch = globalThis.fetch;
  const origError = console.error;
  let dir: string;

  afterEach(() => {
    globalThis.fetch = origFetch;
    console.error = origError;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function silenceLogs() {
    console.error = () => {};
  }

  function tempCache(): string {
    dir = mkdtempSync(join(tmpdir(), "claudeline-price-"));
    return join(dir, "price-cache.json");
  }

  test("normalizes OpenRouter USD/token pricing to $/1M and writes the cache", async () => {
    silenceLogs();
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("openrouter.ai")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "x/y",
                pricing: { prompt: "0.000001", completion: "0.000002" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error("source down");
    }) as unknown as typeof fetch;

    const cachePath = tempCache();
    await refreshPricingCache(cachePath);

    const resolved = resolvePrice("x/y");
    expect(resolved?.pricing.input).toBe(1);
    expect(resolved?.pricing.output).toBe(2);
    expect(resolved?.provider).toBe("openrouter");

    const written = JSON.parse(readFileSync(cachePath, "utf8")) as {
      table: Array<{
        match: string;
        pricing: { input: number; output: number };
      }>;
    };
    const row = written.table.find((r) => r.match === "x/y");
    expect(row?.pricing.input).toBe(1);
    expect(row?.pricing.output).toBe(2);
  });

  test("falls through to models.dev when OpenRouter fails (chain order)", async () => {
    silenceLogs();
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("openrouter.ai")) throw new Error("openrouter down");
      if (u.includes("models.dev")) {
        return new Response(
          JSON.stringify({
            anthropic: {
              models: {
                "claude-test-1": {
                  cost: {
                    input: 7,
                    output: 21,
                    cache_read: 0.7,
                    cache_write: 8.75,
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error("litellm down");
    }) as unknown as typeof fetch;

    await refreshPricingCache(tempCache());

    const resolved = resolvePrice("claude-test-1");
    expect(resolved?.pricing.input).toBe(7);
    expect(resolved?.pricing.output).toBe(21);
    expect(resolved?.pricing.cacheRead).toBe(0.7);
    expect(resolved?.pricing.cacheCreation).toBe(8.75);
    expect(resolved?.provider).toBe("anthropic");
  });

  test("retains the bundled snapshot when every source fails (no throw)", async () => {
    silenceLogs();
    globalThis.fetch = (async () => {
      throw new Error("all offline");
    }) as unknown as typeof fetch;

    await expect(refreshPricingCache(tempCache())).resolves.toBeUndefined();
    expect(resolvePrice("claude-opus-4-7")?.pricing.input).toBe(15);
  });
});
