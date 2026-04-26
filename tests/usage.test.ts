import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRateLimitsFromInput, renderRateLines } from "../src/usage.js";
import {
  loadJsonCache,
  saveJsonCache,
} from "../src/cache.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("extractRateLimitsFromInput", () => {
  test("reads percentages and reset epochs from stdin", () => {
    const result = extractRateLimitsFromInput({
      rate_limits: {
        five_hour: {
          used_percentage: 18,
          resets_at: "2026-04-26T22:30:00Z",
        },
        seven_day: {
          used_percentage: 42,
          resets_at: "2026-05-01T22:00:00Z",
        },
      },
    });
    expect(result).not.toBeNull();
    expect(result?.fiveHour?.pct).toBe(18);
    expect(result?.fiveHour?.resetEpoch).toBe(
      Math.floor(Date.parse("2026-04-26T22:30:00Z") / 1000),
    );
    expect(result?.sevenDay?.pct).toBe(42);
  });

  test("returns null when no rate_limits in stdin", () => {
    expect(extractRateLimitsFromInput({})).toBeNull();
    expect(extractRateLimitsFromInput({ rate_limits: {} })).toBeNull();
  });

  test("accepts numeric resets_at as epoch", () => {
    const result = extractRateLimitsFromInput({
      rate_limits: { five_hour: { used_percentage: 5, resets_at: 1777221900 } },
    });
    expect(result?.fiveHour?.resetEpoch).toBe(1777221900);
  });
});

describe("renderRateLines", () => {
  test("renders current and weekly lines", () => {
    const out = renderRateLines(
      {
        fiveHour: { pct: 6, resetEpoch: 1777221900 },
        sevenDay: { pct: 18, resetEpoch: 1777608000 },
        extra: undefined,
      },
      { use24h: true, timeZone: "Europe/Madrid", barWidth: 10 },
    );
    const plain = stripAnsi(out);
    expect(plain).toContain("current");
    expect(plain).toContain("6%");
    expect(plain).toContain("18:45");
    expect(plain).toContain("weekly");
    expect(plain).toContain("18%");
  });

  test("renders extra line when enabled", () => {
    const out = renderRateLines(
      {
        fiveHour: undefined,
        sevenDay: undefined,
        extra: {
          enabled: true,
          pct: 25,
          usedCents: 250,
          limitCents: 1000,
          resetLabel: "may 1",
        },
      },
      { use24h: true, timeZone: "Europe/Madrid", barWidth: 10 },
    );
    expect(stripAnsi(out)).toContain("extra");
    expect(stripAnsi(out)).toContain("$2.50");
    expect(stripAnsi(out)).toContain("$10.00");
    expect(stripAnsi(out)).toContain("may 1");
  });

  test("returns empty when nothing to show", () => {
    expect(
      renderRateLines(
        { fiveHour: undefined, sevenDay: undefined, extra: undefined },
        { use24h: true, timeZone: "UTC", barWidth: 10 },
      ),
    ).toBe("");
  });
});

describe("cache file", () => {
  test("loads fresh cache within TTL", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-cache-"));
    const file = join(dir, "cache.json");
    try {
      saveJsonCache(file, { hello: 42 });
      const loaded = loadJsonCache(file, 60_000);
      expect(loaded).toEqual({ hello: 42 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when cache expired", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-cache-"));
    const file = join(dir, "cache.json");
    try {
      writeFileSync(file, JSON.stringify({ x: 1 }));
      const oldTime = new Date(Date.now() - 10 * 60_000);
      const fs = require("node:fs") as typeof import("node:fs");
      fs.utimesSync(file, oldTime, oldTime);
      expect(loadJsonCache(file, 60_000)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when file missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-cache-"));
    try {
      expect(loadJsonCache(join(dir, "nope.json"), 60_000)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("saveJsonCache replaces a pre-existing symlink instead of writing through it", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-cache-sym-"));
    const target = join(dir, "victim.json");
    const cache = join(dir, "cache.json");
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      fs.writeFileSync(target, "ORIGINAL");
      fs.symlinkSync(target, cache);
      saveJsonCache(cache, { hello: "safe" });
      // Victim must be untouched, cache must hold our payload.
      expect(fs.readFileSync(target, "utf-8")).toBe("ORIGINAL");
      expect(JSON.parse(fs.readFileSync(cache, "utf-8"))).toEqual({
        hello: "safe",
      });
      // The cache path should no longer be a symlink.
      expect(fs.lstatSync(cache).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadJsonCache refuses to follow a symlink (O_NOFOLLOW)", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-cache-nofollow-"));
    const real = join(dir, "real.json");
    const cache = join(dir, "cache.json");
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      fs.writeFileSync(real, JSON.stringify({ shouldNotLeak: true }));
      fs.symlinkSync(real, cache);
      // O_NOFOLLOW errors with ELOOP; loader catches and returns undefined.
      expect(loadJsonCache(cache, 60_000)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
