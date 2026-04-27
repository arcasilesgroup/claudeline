import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, projectMinutes, saveState } from "../src/state.js";

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
