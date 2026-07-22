import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every case here spawns a fresh `node dist/cli.js` subprocess. On Windows
// runners each spawn is scanned by Defender, so cold-start latency jitters
// well past bun's 5000ms default and occasionally trips a spurious timeout
// (observed 5258ms on the first full render). Give this subprocess-integration
// suite headroom without loosening the fast unit tests in other files.
setDefaultTimeout(20_000);

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
    const tmp = fs.mkdtempSync(
      join(require("node:os").tmpdir(), "cl-symlink-"),
    );
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
        '{"model":{"display_name":"Opus"},"cwd":"/tmp","context_window":{"context_window_size":200000,"used_percentage":50,"current_usage":{"input_tokens":1000,"output_tokens":500}},"rate_limits":{"five_hour":{"used_percentage":50,"resets_at":"2026-04-26T22:30:00Z"}}}',
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

  test("doctor exits 0, renders sections + summary + version diagnostic", () => {
    const r = run(["doctor"]);
    expect(r.status).toBe(0);
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain("Summary:");
    expect(plain).toContain("Diagnostics");
    expect(plain).toContain("Configuration");
    // Version-of-claudeline replaces the old "claudeline doctor X" banner;
    // it still tells the user what's running.
    expect(plain).toContain("Version: claudeline");
    // statusLine is the first Configuration check; the label appears
    // regardless of whether the dev environment passes or warns.
    expect(plain.toLowerCase()).toContain("settings");
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

  test("doctor --json emits structured output", () => {
    const r = run(["doctor", "--json"]);
    expect(r.status).toBe(0);
    // Stable schema: editors / dashboards parse this output. Don't break
    // the contract without a major version bump.
    const parsed = JSON.parse(r.stdout) as {
      version: string;
      generated_at: string;
      sections: Array<{
        title: string;
        lines: Array<{ status: string; message: string; fix?: string }>;
      }>;
      summary: { ok: number; warnings: number; errors: number };
    };
    expect(parsed.version).toBe(pkg.version);
    expect(typeof parsed.generated_at).toBe("string");
    // ISO 8601 sanity check.
    expect(parsed.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.sections.map((s) => s.title)).toEqual([
      "Diagnostics",
      "Configuration",
      "Health",
    ]);
    // Every line has the canonical status set.
    for (const s of parsed.sections) {
      for (const l of s.lines) {
        expect(["ok", "info", "warn", "error"]).toContain(l.status);
        expect(typeof l.message).toBe("string");
      }
    }
    expect(typeof parsed.summary.ok).toBe("number");
    expect(typeof parsed.summary.warnings).toBe("number");
    expect(typeof parsed.summary.errors).toBe("number");
    // No ANSI in JSON output.
    expect(r.stdout).not.toMatch(/\x1b\[/);
  });

  test("doctor --json includes fix strings on warn/error lines", () => {
    const r = spawnSync("node", [dist, "doctor", "--json"], {
      encoding: "utf-8",
      env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: "max" },
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      sections: Array<{
        lines: Array<{ status: string; message: string; fix?: string }>;
      }>;
    };
    const lines = parsed.sections.flatMap((s) => s.lines);
    const envWarn = lines.find((l) =>
      l.message.includes("CLAUDE_CODE_EFFORT_LEVEL=max"),
    );
    expect(envWarn).toBeDefined();
    expect(envWarn?.status).toBe("warn");
    expect(envWarn?.fix).toContain("/model");
  });
});

describe("adoptCachedUsage (cache-shape migration)", () => {
  // Lazy import keeps the spawn-based cli tests above isolated from
  // any side-effects of loading `cache.js`.
  test("rejects pre-0.2 UsageApiResponse-shaped cache (no .data wrapper)", async () => {
    const { adoptCachedUsage } = await import("../src/cache.js");
    const stale = {
      five_hour: { utilization: 5, resets_at: "2026-04-26T22:30:00Z" },
    };
    expect(adoptCachedUsage(stale)).toBeUndefined();
  });

  test("accepts 0.2 cache shape", async () => {
    const { adoptCachedUsage } = await import("../src/cache.js");
    const fresh = {
      data: { five_hour: { utilization: 5 } },
      latencyMs: 100,
    };
    expect(adoptCachedUsage(fresh)).toEqual(fresh);
  });

  test("rejects null, primitives, arrays, and missing data field", async () => {
    const { adoptCachedUsage } = await import("../src/cache.js");
    expect(adoptCachedUsage(null)).toBeUndefined();
    expect(adoptCachedUsage("string")).toBeUndefined();
    expect(adoptCachedUsage(42)).toBeUndefined();
    expect(adoptCachedUsage([])).toBeUndefined();
    expect(adoptCachedUsage({ data: null })).toBeUndefined();
    expect(adoptCachedUsage({ data: 42 })).toBeUndefined();
    expect(adoptCachedUsage({ data: [] })).toBeUndefined();
  });

  test("forward-compatibly defaults missing latencyMs to 0", async () => {
    const { adoptCachedUsage } = await import("../src/cache.js");
    const partial = { data: { five_hour: {} } };
    const adopted = adoptCachedUsage(partial);
    expect(adopted?.latencyMs).toBe(0);
  });
});

describe("parseBooleanEnv (CLAUDELINE_PREFER_API and friends)", () => {
  test("returns false for unset / empty", async () => {
    const { parseBooleanEnv } = await import("../src/cli.js");
    expect(parseBooleanEnv(undefined)).toBe(false);
    expect(parseBooleanEnv("")).toBe(false);
    expect(parseBooleanEnv("   ")).toBe(false);
  });

  test("returns true for 1 / true / yes (case-insensitive)", async () => {
    const { parseBooleanEnv } = await import("../src/cli.js");
    expect(parseBooleanEnv("1")).toBe(true);
    expect(parseBooleanEnv("true")).toBe(true);
    expect(parseBooleanEnv("TRUE")).toBe(true);
    expect(parseBooleanEnv("True")).toBe(true);
    expect(parseBooleanEnv("yes")).toBe(true);
    expect(parseBooleanEnv("YES")).toBe(true);
    expect(parseBooleanEnv("  yes  ")).toBe(true);
  });

  test("returns false for everything else (including 0, false, garbage)", async () => {
    const { parseBooleanEnv } = await import("../src/cli.js");
    expect(parseBooleanEnv("0")).toBe(false);
    expect(parseBooleanEnv("false")).toBe(false);
    expect(parseBooleanEnv("nope")).toBe(false);
    expect(parseBooleanEnv("2")).toBe(false);
  });
});

describe("resolveCacheTtlMs (CLAUDELINE_CACHE_TTL_SEC)", () => {
  test("defaults to 30000ms when env unset", async () => {
    const { resolveCacheTtlMs } = await import("../src/cli.js");
    expect(resolveCacheTtlMs(undefined)).toBe(30_000);
    expect(resolveCacheTtlMs("")).toBe(30_000);
  });

  test("accepts a valid in-range value", async () => {
    const { resolveCacheTtlMs } = await import("../src/cli.js");
    expect(resolveCacheTtlMs("15")).toBe(15_000);
    expect(resolveCacheTtlMs("60")).toBe(60_000);
    expect(resolveCacheTtlMs("1")).toBe(1_000);
    expect(resolveCacheTtlMs("300")).toBe(300_000);
  });

  test("rejects out-of-range values silently and returns the default", async () => {
    // Out-of-range falls back to default rather than throwing — the
    // hot path should never crash on a fat-fingered env var.
    const { resolveCacheTtlMs } = await import("../src/cli.js");
    expect(resolveCacheTtlMs("0")).toBe(30_000); // below MIN
    expect(resolveCacheTtlMs("-5")).toBe(30_000);
    expect(resolveCacheTtlMs("999")).toBe(30_000); // above MAX
    expect(resolveCacheTtlMs("garbage")).toBe(30_000);
    expect(resolveCacheTtlMs("NaN")).toBe(30_000);
  });
});
