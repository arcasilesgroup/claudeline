import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/mini";
import { renderStatusline } from "../src/render.js";
import { statuslineInputSchema } from "../src/schemas.js";
import { mockDeps, stripAnsi } from "./_mockDeps.js";

// Fixtures captured from a real Claude Code 2.1.119 session via a tap
// wrapper that recorded stdin payloads. Re-running these against the
// schema and the renderer catches regressions when:
//   - Anthropic ships a new field shape we don't yet honour
//   - Our schema starts rejecting a payload it used to accept
//   - The renderer crashes on a real-world combination of flags
//
// To refresh fixtures, run the tap wrapper described in
// CONTRIBUTING.md (or capture stdin manually) and overwrite the
// JSON files in this directory.

const fixturesDir = join(import.meta.dirname, "fixtures");
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .map((name) => ({
    name,
    payload: JSON.parse(readFileSync(join(fixturesDir, name), "utf-8")),
  }));

describe("real Claude Code stdin fixtures", () => {
  test("at least one fixture is present (else the suite is meaningless)", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  test("fixtures cover the matrix of optional flags", () => {
    // The suite is only useful if the fixtures actually differ. If they
    // all carry the same flags, three fixtures buy us nothing over one.
    const flags = fixtures.map(({ payload }) => ({
      fast: payload.fast_mode === true,
      large: payload.exceeds_200k_tokens === true,
      smallCost:
        typeof payload.cost?.total_cost_usd === "number" &&
        payload.cost.total_cost_usd < 1,
    }));
    expect(flags.some((f) => f.fast)).toBe(true);
    expect(flags.some((f) => !f.large)).toBe(true);
    expect(flags.some((f) => f.smallCost)).toBe(true);
  });

  for (const { name, payload } of fixtures) {
    describe(name, () => {
      test("parses through the stdin schema without throwing", () => {
        expect(() => z.parse(statuslineInputSchema, payload)).not.toThrow();
      });

      test("renders without throwing", async () => {
        const parsed = z.parse(statuslineInputSchema, payload);
        const out = await renderStatusline(parsed, mockDeps());
        expect(out.length).toBeGreaterThan(0);
      });

      test("cost segment uses cost.total_cost_usd when present", async () => {
        if (typeof payload.cost?.total_cost_usd !== "number") return;
        const parsed = z.parse(statuslineInputSchema, payload);
        const out = await renderStatusline(parsed, mockDeps());
        const expected = payload.cost.total_cost_usd >= 1
          ? `$${payload.cost.total_cost_usd.toFixed(2)}`
          : `$${payload.cost.total_cost_usd.toFixed(3)}`;
        expect(stripAnsi(out)).toContain(expected);
      });

      test("model display_name appears in render", async () => {
        if (!payload.model?.display_name) return;
        const parsed = z.parse(statuslineInputSchema, payload);
        const out = await renderStatusline(parsed, mockDeps());
        expect(stripAnsi(out)).toContain(payload.model.display_name);
      });
    });
  }
});
