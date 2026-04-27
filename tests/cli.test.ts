import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist", "cli.js");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
  version: string;
};

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function run(args: string[], stdin = "") {
  return spawnSync("node", [dist, ...args], {
    input: stdin,
    encoding: "utf-8",
  });
}

beforeAll(() => {
  if (existsSync(dist)) return;
  const result = spawnSync(
    "bun",
    [
      "build",
      "src/cli.ts",
      "--target=node",
      "--outfile=dist/cli.js",
      "--minify",
      "--banner=#!/usr/bin/env node",
    ],
    { cwd: root, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`bun build failed: ${result.stderr}`);
  }
});

describe("cli", () => {
  test("dist/cli.js exists after beforeAll", () => {
    expect(existsSync(dist)).toBe(true);
  });

  test("--version matches package.json", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  test("-v shorthand", () => {
    const r = run(["-v"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  test("--help prints usage and exits 0", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("claudeline render");
  });

  test("unknown command exits 2", () => {
    const r = run(["bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  test("render with empty stdin prints 'Claude'", () => {
    const r = run(["render"], "");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Claude");
  });

  test("render with malformed JSON falls back to 'Claude'", () => {
    const r = run(["render"], "not json");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Claude");
  });

  test("render with valid JSON emits the model name", () => {
    const r = run(
      ["render"],
      '{"model":{"display_name":"Opus 4.7"},"cwd":"/tmp"}',
    );
    expect(r.status).toBe(0);
    expect(stripAnsi(r.stdout)).toContain("Opus 4.7");
    expect(stripAnsi(r.stdout)).toContain("tmp");
  });

  test("render tolerates null fields without collapsing", () => {
    const r = run(
      ["render"],
      '{"model":{"display_name":"Opus"},"effort":{"level":null},"thinking":{"enabled":null},"cwd":"/tmp"}',
    );
    expect(r.status).toBe(0);
    expect(stripAnsi(r.stdout)).toContain("Opus");
    expect(stripAnsi(r.stdout)).not.toBe("Claude");
  });

  test("render renders effort high glyph", () => {
    const r = run(
      ["render"],
      '{"model":{"display_name":"X"},"effort":{"level":"high"},"cwd":"/tmp"}',
    );
    expect(stripAnsi(r.stdout)).toContain("● high");
  });

  test("render with stdin > 1 MiB falls back silently", () => {
    const big = "x".repeat(1100000);
    const r = run(["render"], big);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Claude");
  });

  test("--version reports a semver string", () => {
    const r = run(["--version"]);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--version works when invoked via a symlink (regression: 0.2.0 was silent)", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const tmp = fs.mkdtempSync(join(require("node:os").tmpdir(), "cl-symlink-"));
    const link = join(tmp, "claudeline");
    try {
      fs.symlinkSync(dist, link);
      const r = spawnSync("node", [link, "--version"], { encoding: "utf-8" });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(pkg.version);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("CLAUDELINE_GLYPHS=plain switches glyphs to ASCII", () => {
    const r = spawnSync("node", [dist, "render"], {
      input:
        '{"model":{"display_name":"Opus"},"cwd":"/tmp","rate_limits":{"five_hour":{"used_percentage":50,"resets_at":"2026-04-26T22:30:00Z"}}}',
      encoding: "utf-8",
      env: { ...process.env, CLAUDELINE_GLYPHS: "plain" },
    });
    expect(r.status).toBe(0);
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain("ctx:");
    expect(plain).toContain("#");
    expect(plain).not.toContain("✍️");
  });

  test("render emits cost segment for known model id", () => {
    const r = run(
      ["render"],
      JSON.stringify({
        model: { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6" },
        cwd: "/tmp",
        context_window: {
          current_usage: { input_tokens: 500_000, output_tokens: 50_000 },
        },
      }),
    );
    expect(stripAnsi(r.stdout)).toMatch(/\$\d+\.\d{2,3}/);
  });

  test("render does not surface latency badge when stdin carries rate limits", () => {
    const r = run(
      ["render"],
      JSON.stringify({
        model: { display_name: "Opus" },
        cwd: "/tmp",
        rate_limits: {
          five_hour: { used_percentage: 5, resets_at: "2026-04-26T22:30:00Z" },
        },
      }),
    );
    expect(stripAnsi(r.stdout)).not.toContain("ms");
  });

  test("doctor exits 0, contains a Summary line and a recognizable check label", () => {
    const r = run(["doctor"]);
    expect(r.status).toBe(0);
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain("Summary:");
    // statusLine is the first check; this label should appear regardless
    // of whether the dev environment passes or warns.
    expect(plain.toLowerCase()).toContain("settings");
    // Doctor banner identifies itself.
    expect(plain).toContain("claudeline doctor");
  });

  test("doctor warns about CLAUDE_CODE_EFFORT_LEVEL when set in env", () => {
    const r = spawnSync("node", [dist, "doctor"], {
      encoding: "utf-8",
      env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: "max" },
    });
    expect(r.status).toBe(0);
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain("CLAUDE_CODE_EFFORT_LEVEL=max");
    expect(plain).toContain("/model");
  });

  test("doctor still exits 0 when warnings fire (informational)", () => {
    const r = spawnSync("node", [dist, "doctor"], {
      encoding: "utf-8",
      env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: "low" },
    });
    expect(r.status).toBe(0);
  });
});

describe("adoptCachedUsage (cache-shape migration)", () => {
  // Lazy import so the cli module only loads when this describe runs;
  // keeps the spawn-based tests above isolated.
  test("rejects pre-0.2 UsageApiResponse-shaped cache (no .data wrapper)", async () => {
    const { adoptCachedUsage } = await import("../src/cli.js");
    const stale = {
      five_hour: { utilization: 5, resets_at: "2026-04-26T22:30:00Z" },
    };
    expect(adoptCachedUsage(stale)).toBeUndefined();
  });

  test("accepts 0.2 cache shape", async () => {
    const { adoptCachedUsage } = await import("../src/cli.js");
    const fresh = {
      data: { five_hour: { utilization: 5 } },
      latencyMs: 100,
    };
    expect(adoptCachedUsage(fresh)).toEqual(fresh);
  });

  test("rejects null, primitives, arrays, and missing data field", async () => {
    const { adoptCachedUsage } = await import("../src/cli.js");
    expect(adoptCachedUsage(null)).toBeUndefined();
    expect(adoptCachedUsage("string")).toBeUndefined();
    expect(adoptCachedUsage(42)).toBeUndefined();
    expect(adoptCachedUsage([])).toBeUndefined();
    expect(adoptCachedUsage({ data: null })).toBeUndefined();
    expect(adoptCachedUsage({ data: 42 })).toBeUndefined();
    expect(adoptCachedUsage({ data: [] })).toBeUndefined();
  });

  test("forward-compatibly defaults missing latencyMs to 0", async () => {
    const { adoptCachedUsage } = await import("../src/cli.js");
    const partial = { data: { five_hour: {} } };
    const adopted = adoptCachedUsage(partial);
    expect(adopted?.latencyMs).toBe(0);
  });
});
