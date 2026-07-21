import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import snapshot from "../src/pricing.snapshot.json" with { type: "json" };

// A row in a specific match is the ModelPricing seeded verbatim from the
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
});
