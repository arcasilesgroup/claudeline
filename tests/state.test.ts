import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLatencySample,
  latencyPercentiles,
  loadState,
  projectMinutes,
  saveState,
} from "../src/state.js";

describe("saveState / loadState", () => {
  test("round-trips state through atomic write", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-"));
    const file = join(dir, "state.json");
    try {
      saveState(file, { fiveHour: { pct: 42, epoch: 1777221900 } });
      expect(loadState(file)).toEqual({
        fiveHour: { pct: 42, epoch: 1777221900 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("round-trips an empty state", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-empty-"));
    const file = join(dir, "state.json");
    try {
      saveState(file, {});
      expect(loadState(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed sample shapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-bad-"));
    const file = join(dir, "state.json");
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      fs.writeFileSync(file, JSON.stringify({ fiveHour: "garbage" }));
      expect(loadState(file)).toEqual({});
      fs.writeFileSync(file, JSON.stringify({ fiveHour: { pct: "x" } }));
      expect(loadState(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects array as state body", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-arr-"));
    const file = join(dir, "state.json");
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      fs.writeFileSync(file, JSON.stringify([1, 2, 3]));
      expect(loadState(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadState returns {} when file missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-"));
    try {
      expect(loadState(join(dir, "nope.json"))).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadState refuses to follow symlinks", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-sym-"));
    const real = join(dir, "real.json");
    const file = join(dir, "state.json");
    try {
      writeFileSync(real, '{"fiveHour":{"pct":99,"epoch":1}}');
      symlinkSync(real, file);
      expect(loadState(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("saveState replaces a pre-existing symlink instead of writing through", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-sym2-"));
    const target = join(dir, "victim.json");
    const file = join(dir, "state.json");
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      fs.writeFileSync(target, "ORIGINAL");
      fs.symlinkSync(target, file);
      saveState(file, { fiveHour: { pct: 50, epoch: 1 } });
      expect(fs.readFileSync(target, "utf-8")).toBe("ORIGINAL");
      expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("projectMinutes", () => {
  test("returns undefined without previous sample", () => {
    expect(projectMinutes(undefined, { pct: 10, epoch: 100 })).toBeUndefined();
  });

  test("returns undefined when burn rate is zero or negative", () => {
    expect(
      projectMinutes({ pct: 50, epoch: 100 }, { pct: 50, epoch: 200 }),
    ).toBeUndefined();
    expect(
      projectMinutes({ pct: 50, epoch: 100 }, { pct: 40, epoch: 200 }),
    ).toBeUndefined();
  });

  test("returns minutes-to-100% at the observed rate", () => {
    // 10% in 60s => 10%/min. From 50%, 50 more pct => 5 minutes.
    expect(
      projectMinutes({ pct: 40, epoch: 1000 }, { pct: 50, epoch: 1060 }),
    ).toBe(5);
  });

  test("returns undefined when interval is too short", () => {
    expect(
      projectMinutes({ pct: 10, epoch: 100 }, { pct: 11, epoch: 102 }),
    ).toBeUndefined();
  });

  test("returns undefined when interval is too long (stale)", () => {
    // 35 minutes between samples — too stale to trust.
    expect(
      projectMinutes(
        { pct: 10, epoch: 0 },
        { pct: 50, epoch: 35 * 60 },
      ),
    ).toBeUndefined();
  });

  test("returns 0 when already at 100%", () => {
    expect(
      projectMinutes(
        { pct: 99, epoch: 1000 },
        { pct: 100, epoch: 1060 },
      ),
    ).toBe(0);
  });

  test("caps absurdly long projections at 24h", () => {
    // 0.001% per minute would project 100,000 minutes. Should be undef.
    expect(
      projectMinutes(
        { pct: 50.0, epoch: 0 },
        { pct: 50.001, epoch: 60 },
      ),
    ).toBeUndefined();
  });
});

describe("appendLatencySample", () => {
  test("adds a new sample to an empty state", () => {
    const next = appendLatencySample({}, { ms: 230, epoch: 1000 });
    expect(next.latencySamples).toEqual([{ ms: 230, epoch: 1000 }]);
  });

  test("appends to an existing list", () => {
    const next = appendLatencySample(
      { latencySamples: [{ ms: 100, epoch: 900 }] },
      { ms: 200, epoch: 1000 },
    );
    expect(next.latencySamples).toEqual([
      { ms: 100, epoch: 900 },
      { ms: 200, epoch: 1000 },
    ]);
  });

  test("prunes samples older than the window", () => {
    const old = { ms: 50, epoch: 100 };
    const recent = { ms: 100, epoch: 4000 };
    // window 60min = 3600s; cutoff for sample.epoch=4000 is 400.
    const next = appendLatencySample(
      { latencySamples: [old, recent] },
      { ms: 200, epoch: 4000 },
    );
    expect(next.latencySamples).toEqual([recent, { ms: 200, epoch: 4000 }]);
  });

  test("respects custom window option", () => {
    const next = appendLatencySample(
      { latencySamples: [{ ms: 50, epoch: 1000 }] },
      { ms: 200, epoch: 1100 },
      { windowSec: 30 },
    );
    // cutoff = 1070; 1000 < 1070 so older sample dropped
    expect(next.latencySamples).toEqual([{ ms: 200, epoch: 1100 }]);
  });

  test("caps the array at maxSamples (newest wins, oldest are evicted)", () => {
    const seed = Array.from({ length: 5 }, (_, i) => ({
      ms: i * 10,
      epoch: 1000 + i,
    }));
    const next = appendLatencySample(
      { latencySamples: seed },
      { ms: 999, epoch: 1100 },
      { maxSamples: 3 },
    );
    expect(next.latencySamples).toHaveLength(3);
    // After appending, kept = [0,10,20,30,40,999]. Slice keeps the last 3.
    // We must verify which samples were evicted, not just the trailing one
    // — a bug that trimmed from the end (head) instead would still pass a
    // length+last assertion.
    expect(next.latencySamples?.map((s) => s.ms)).toEqual([30, 40, 999]);
  });

  test("does NOT trim when length equals maxSamples (boundary)", () => {
    // Append from length-2 → length-3 with cap=3; no trim should happen.
    const seed = Array.from({ length: 2 }, (_, i) => ({
      ms: i * 10,
      epoch: 1000 + i,
    }));
    const next = appendLatencySample(
      { latencySamples: seed },
      { ms: 99, epoch: 1010 },
      { maxSamples: 3 },
    );
    expect(next.latencySamples).toHaveLength(3);
    expect(next.latencySamples?.map((s) => s.ms)).toEqual([0, 10, 99]);
  });

  test("trims exactly one when length is maxSamples + 1 (boundary)", () => {
    const seed = Array.from({ length: 3 }, (_, i) => ({
      ms: i * 10,
      epoch: 1000 + i,
    }));
    const next = appendLatencySample(
      { latencySamples: seed },
      { ms: 99, epoch: 1010 },
      { maxSamples: 3 },
    );
    expect(next.latencySamples).toHaveLength(3);
    // Kept = [0,10,20,99]; slice(-3) drops ms:0 and keeps the rest.
    expect(next.latencySamples?.map((s) => s.ms)).toEqual([10, 20, 99]);
  });

  test("keeps samples exactly at the cutoff (inclusive boundary)", () => {
    // sample.epoch=4000, windowSec=3600 → cutoff=400; `s.epoch >= cutoff`
    // should keep a sample exactly at 400 and drop one at 399.
    const onCutoff = { ms: 50, epoch: 400 };
    const justBefore = { ms: 60, epoch: 399 };
    const next = appendLatencySample(
      { latencySamples: [justBefore, onCutoff] },
      { ms: 200, epoch: 4000 },
    );
    expect(next.latencySamples).toEqual([onCutoff, { ms: 200, epoch: 4000 }]);
  });

  test("rejects samples with negative or non-finite ms", () => {
    // Defense at the persistence boundary: a single negative or NaN
    // sample would otherwise contaminate p50/p99 for up to 60 minutes.
    const seed: { ms: number; epoch: number }[] = [];
    expect(
      appendLatencySample({ latencySamples: seed }, { ms: -1, epoch: 100 })
        .latencySamples,
    ).toEqual([]);
    expect(
      appendLatencySample({ latencySamples: seed }, { ms: NaN, epoch: 100 })
        .latencySamples,
    ).toEqual([]);
    expect(
      appendLatencySample({ latencySamples: seed }, {
        ms: 100,
        epoch: NaN,
      }).latencySamples,
    ).toEqual([]);
  });

  test("preserves the rest of state untouched", () => {
    const result = appendLatencySample(
      { fiveHour: { pct: 42, epoch: 1 } },
      { ms: 100, epoch: 2 },
    );
    expect(result.fiveHour).toEqual({ pct: 42, epoch: 1 });
    expect(result.latencySamples).toHaveLength(1);
  });

  test("handles identical samples (same epoch + ms)", () => {
    const next = appendLatencySample(
      { latencySamples: [{ ms: 100, epoch: 1000 }] },
      { ms: 100, epoch: 1000 },
    );
    expect(next.latencySamples).toHaveLength(2);
  });
});

describe("latencyPercentiles", () => {
  test("returns undefined when fewer than 5 samples", () => {
    expect(latencyPercentiles(undefined)).toBeUndefined();
    expect(latencyPercentiles([])).toBeUndefined();
    expect(
      latencyPercentiles([
        { ms: 100, epoch: 1 },
        { ms: 200, epoch: 2 },
        { ms: 300, epoch: 3 },
        { ms: 400, epoch: 4 },
      ]),
    ).toBeUndefined();
  });

  test("computes p50 and p99 for a 5-sample window", () => {
    const samples = [100, 200, 300, 400, 500].map((ms, i) => ({
      ms,
      epoch: i,
    }));
    const result = latencyPercentiles(samples);
    // Sorted: [100,200,300,400,500]. p50: ceil(0.5*5)=3 → idx 2 → 300.
    // p99: ceil(0.99*5)=5 → idx 4 → 500.
    expect(result).toEqual({ p50: 300, p99: 500 });
  });

  test("identical samples → percentile equals the value", () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({
      ms: 250,
      epoch: i,
    }));
    expect(latencyPercentiles(samples)).toEqual({ p50: 250, p99: 250 });
  });

  test("p99 picks the actual tail value, not interpolation", () => {
    const samples = [10, 10, 10, 10, 10, 10, 10, 10, 10, 5000].map(
      (ms, i) => ({ ms, epoch: i }),
    );
    expect(latencyPercentiles(samples)).toEqual({ p50: 10, p99: 5000 });
  });

  test("ignores ordering of input — percentile uses sorted values", () => {
    const samples = [500, 100, 400, 200, 300].map((ms, i) => ({
      ms,
      epoch: i,
    }));
    expect(latencyPercentiles(samples)).toEqual({ p50: 300, p99: 500 });
  });
});

describe("loadState with latencySamples", () => {
  test("round-trips latencySamples through atomic write", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-lat-"));
    const file = join(dir, "state.json");
    try {
      saveState(file, {
        latencySamples: [
          { ms: 230, epoch: 1 },
          { ms: 450, epoch: 2 },
        ],
      });
      expect(loadState(file).latencySamples).toEqual([
        { ms: 230, epoch: 1 },
        { ms: 450, epoch: 2 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed latencySamples entries silently", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-latbad-"));
    const file = join(dir, "state.json");
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({
          latencySamples: [
            { ms: 100, epoch: 1 },
            { ms: "x", epoch: 2 },
            "garbage",
          ],
        }),
      );
      // Only the valid sample should make it through.
      expect(loadState(file).latencySamples).toEqual([{ ms: 100, epoch: 1 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores latencySamples when not an array", () => {
    const dir = mkdtempSync(join(tmpdir(), "claudeline-state-latnotarr-"));
    const file = join(dir, "state.json");
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      fs.writeFileSync(file, JSON.stringify({ latencySamples: "x" }));
      expect(loadState(file).latencySamples).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
