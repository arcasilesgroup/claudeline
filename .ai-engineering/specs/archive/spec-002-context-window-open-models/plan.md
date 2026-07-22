---
spec: spec-002
title: "Context window resolution for open models"
status: draft
effort: small
pipeline: standard
executor: build
safe_next_command: "/ai-build"
execution_route:
  version: 1
  executor: build
  automation: standard
  concern_count: 1
  estimated_files: 3
  reason: "Single-concern enhancement: extend pricingSource.ts to resolve context windows, add seed rows, wire render.ts fallback."
---

## Architecture

Extends the existing fetch-guard-fallback pattern from spec-001. No new modules — `pricingSource.ts` gains a parallel `contextCache` + `resolveContextWindow()` alongside the existing `cache` + `resolvePrice()`. Same three sources, same cache file, same in-memory lifecycle.

## Phase 1: RED (TDD — tests first)

- [x] T-1 — Write tests for resolveContextWindow + buildContextInput open model path — DONE
- Agent: build
- Files: tests/pricingSource.test.ts, tests/render.test.ts
- Principles applied: §10.5 TDD
- Patch (deterministic):
```diff
// tests/pricingSource.test.ts — add after resolvePrice tests
+describe("resolveContextWindow (bundled/offline)", () => {
+  test("returns context window for known open model", () => {
+    const ctx = resolveContextWindow("gpt-4o");
+    expect(ctx).toBe(128_000);
+  });
+
+  test("fuzzy matches openrouter model ids", () => {
+    const ctx = resolveContextWindow("openrouter/meta-llama/llama-3-8b");
+    expect(ctx).toBe(128_000);
+  });
+
+  test("returns undefined for unknown model", () => {
+    expect(resolveContextWindow("totally-unknown-xyz")).toBeUndefined();
+  });
+
+  test("returns undefined for null/undefined input", () => {
+    expect(resolveContextWindow(null)).toBeUndefined();
+    expect(resolveContextWindow(undefined)).toBeUndefined();
+  });
+});
```
```diff
// tests/render.test.ts — add test for open model context fallback
+  test("uses resolved context window for open model when stdin omits size", async () => {
+    const data = await renderStatuslineData(
+      {
+        model: { id: "openrouter/meta-llama/llama-3-8b", display_name: "Llama 3 8B" },
+        cwd: "/tmp",
+        context_window: {
+          current_usage: { input_tokens: 50_000, output_tokens: 1000 },
+          // No context_window_size — should resolve from live source
+        },
+      },
+      mockDeps(),
+      { version: "9.9.9" },
+    );
+    // Llama 3 = 128K; 50K/128K ≈ 39%
+    expect(data.context.window_size).toBe(128_000);
+    expect(data.context.used_percentage).toBeNull(); // no server %; computed from tokens
+  });
```
- Gate: `bun test` — T-1 RED (tests fail, implementation absent)

## Phase 2: GREEN (implementation)

- [x] T-2 — Extend pricingSource.ts: new types, contextCache, resolveContextWindow, extend fetchers — DONE
- Agent: build
- Files: src/pricingSource.ts
- Principles applied: §10.4 DRY, §10.7 Clean Code
- Patch (deterministic):
```diff
 import type { ModelPricing } from "./segments.js";

+/** Context window size (max tokens) for a model. */
+export type ContextWindowSize = number;
+
+interface ContextWindowRow {
+  match: string;
+  contextWindow: ContextWindowSize;
+}
+
 // Bundled seed — always present, the terminal fallback of the chain.
 const BUNDLED: readonly PriceRow[] = snapshot.table;
+const BUNDLED_CTX: readonly ContextWindowRow[] = snapshot.contextWindows ?? [];
+
 // In-memory table used by `resolvePrice`.
 let cache: readonly PriceRow[] = BUNDLED;
+let contextCache: readonly ContextWindowRow[] = BUNDLED_CTX;
```
```diff
+/**
+ * Resolve a model id to its context window size. Exact-id first,
+ * then substring (fuzzy) fallback. Returns undefined when nothing matches.
+ */
+export function resolveContextWindow(
+  modelId: string | null | undefined,
+): ContextWindowSize | undefined {
+  if (!modelId) return undefined;
+  const id = modelId.toLowerCase();
+
+  const exact = contextCache.find((row) => row.match === id);
+  if (exact) return exact.contextWindow;
+
+  const fuzzy = contextCache.find((row) => id.includes(row.match));
+  if (fuzzy) return fuzzy.contextWindow;
+
+  return undefined;
+}
```
```diff
 // fetchOpenRouter — extend to extract context_length
 async function fetchOpenRouter(): Promise<PriceRow[]> {
   const body = (await fetchJson("https://openrouter.ai/api/v1/models")) as {
     data?: Array<{
       id?: string;
       pricing?: { prompt?: string; completion?: string };
+      context_length?: number;
     }>;
   };
+  const ctxRows: ContextWindowRow[] = [];
   const rows: PriceRow[] = [];
   for (const model of body.data ?? []) {
     if (!model.id) continue;
     rows.push({ match: model.id.toLowerCase(), pricing: { ... } });
+    if (typeof model.context_length === "number" && model.context_length > 0) {
+      ctxRows.push({ match: model.id.toLowerCase(), contextWindow: model.context_length });
+    }
   }
-  return rows;
+  return { priceRows: rows, contextRows: ctxRows };
 }
```
```diff
 // fetchModelsDev — extend to extract context_window/max_input_tokens
+// (same pattern: return { priceRows, contextRows })
```
```diff
 // fetchLiteLLM — extend to extract context_window/max_input_tokens
+// (same pattern: return { priceRows, contextRows })
```
```diff
 // refreshPricingCache — merge context rows alongside price rows
 export async function refreshPricingCache(...): Promise<void> {
-  const fetched: PriceRow[] = [];
+  const fetchedPrices: PriceRow[] = [];
+  const fetchedCtx: ContextWindowRow[] = [];
   for (const [name, fetchSource] of sources) {
     try {
-      fetched.push(...(await fetchSource()));
+      const result = await fetchSource();
+      fetchedPrices.push(...result.priceRows);
+      fetchedCtx.push(...result.contextRows);
     } catch (err) { ... }
   }
-  const merged: PriceRow[] = [...fetched, ...BUNDLED];
+  const merged: PriceRow[] = [...fetchedPrices, ...BUNDLED];
   cache = merged;
+  const mergedCtx: ContextWindowRow[] = [...fetchedCtx, ...BUNDLED_CTX];
+  contextCache = mergedCtx;
   // Write both tables to cache file
 }
```
```diff
 // loadPricingCache — also load context rows from cache file
 export async function loadPricingCache(...): Promise<void> {
   const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
     table?: PriceRow[];
+    contextWindows?: ContextWindowRow[];
   };
   if (Array.isArray(parsed.table) && parsed.table.length > 0) {
     cache = [...parsed.table, ...BUNDLED];
   }
+  if (Array.isArray(parsed.contextWindows) && parsed.contextWindows.length > 0) {
+    contextCache = [...parsed.contextWindows, ...BUNDLED_CTX];
+  }
 }
```
- Gate: `bun test tests/pricingSource.test.ts` — T-1 GREEN

- [x] T-3 — Add context window seed rows to pricing.snapshot.json — DONE
- Agent: build
- Files: src/pricing.snapshot.json
- Principles applied: §10.2 YAGNI
- Patch (deterministic):
```diff
 {
   "version": 1,
   "generatedAt": "2026-07-21",
-  "table": [...]
+  "table": [...],
+  "contextWindows": [
+    { "match": "gpt-4o", "contextWindow": 128000 },
+    { "match": "llama3", "contextWindow": 128000 },
+    { "match": "llama-3", "contextWindow": 128000 },
+    { "match": "mistral", "contextWindow": 32000 },
+    { "match": "mixtral", "contextWindow": 32000 },
+    { "match": "qwen", "contextWindow": 128000 },
+    { "match": "gemma", "contextWindow": 8192 },
+    { "match": "claude", "contextWindow": 200000 },
+    { "match": "opus", "contextWindow": 200000 },
+    { "match": "sonnet", "contextWindow": 200000 },
+    { "match": "haiku", "contextWindow": 200000 }
+  ]
 }
```
- Gate: `bun test tests/pricingSource.test.ts` — snapshot integrity tests pass

- [x] T-4 — Update buildContextInput() in render.ts to use resolveContextWindow — DONE
- Agent: build
- Files: src/render.ts:389
- Principles applied: §10.3 SOLID
- Patch (deterministic):
```diff
+import { resolveContextWindow } from "./pricingSource.js";
+
 function buildContextInput(input: StatuslineInput) {
   const cw = input.context_window;
   const usage = cw?.current_usage;
   const result = {
-    windowSize: cw?.context_window_size ?? DEFAULT_CONTEXT_WINDOW,
+    windowSize:
+      cw?.context_window_size ??
+      resolveContextWindow(input.model?.id) ??
+      DEFAULT_CONTEXT_WINDOW,
     ...
   };
 }
```
- Gate: `bun test tests/render.test.ts` — open model fallback test GREEN

## Phase 3: VERIFY

- [x] T-5 — Run full test suite + manual verification — DONE
- Agent: verify
- Files: (read-only)
- Principles applied: §10.5 TDD, §10.4 DRY
- Gate: `bun test` — all tests pass, no regressions
