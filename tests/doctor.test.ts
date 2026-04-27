import { describe, expect, test } from "bun:test";
import {
  type DoctorEnv,
  type DoctorReport,
  cacheDirFor,
  checkCacheDirPerms,
  checkCacheShape,
  checkEffortLevelEnv,
  checkEffortLevelSetting,
  checkEngine,
  checkStateShape,
  checkStatusLine,
  checkStdinSchema,
  printReport,
  runDoctor,
} from "../src/doctor.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Build a "happy-path" env where every check passes. Individual tests
// override only the field(s) they care about. This keeps each test
// laser-focused on the behaviour it exercises.
function happyEnv(overrides: Partial<DoctorEnv> = {}): DoctorEnv {
  return {
    envVars: {},
    tmpdir: "/tmp",
    userInfo: { uid: 501 },
    platform: "darwin",
    existsSync: (p: string) =>
      // Cache dir + cache + state files all exist in the happy env.
      p === "/tmp/claudeline-501" ||
      p === "/tmp/claudeline-501/usage-cache.json" ||
      p === "/tmp/claudeline-501/state.json",
    statMode: () => 0o40700,
    readSettings: () => ({
      effortLevel: "high",
      statusLine: { type: "command", command: "claudeline render" },
    }),
    cacheExists: () => true,
    cacheLoadRaw: () => ({
      data: { five_hour: { utilization: 5 } },
      latencyMs: 100,
    }),
    stateExists: () => true,
    stateLoad: () => ({ fiveHour: { pct: 50, epoch: 1777221900 } }),
    nodeVersion: "20.10.0",
    ...overrides,
  };
}

describe("checkStatusLine", () => {
  test("OK when settings.statusLine.command references claudeline", () => {
    const r = checkStatusLine(happyEnv());
    expect(r.status).toBe("ok");
    expect(r.message).toContain("statusLine wired");
  });

  test("ERROR when statusLine missing", () => {
    const r = checkStatusLine(happyEnv({ readSettings: () => ({}) }));
    expect(r.status).toBe("error");
    expect(r.fix).toContain("claudeline install");
  });

  test("ERROR when statusLine command is empty", () => {
    const r = checkStatusLine(
      happyEnv({
        readSettings: () => ({
          statusLine: { type: "command", command: "" },
        }),
      }),
    );
    expect(r.status).toBe("error");
  });

  test("WARN when statusLine.command points at a non-claudeline script", () => {
    const r = checkStatusLine(
      happyEnv({
        readSettings: () => ({
          statusLine: { type: "command", command: "/usr/local/bin/tap.sh" },
        }),
      }),
    );
    expect(r.status).toBe("warn");
    expect(r.message).toContain("tap.sh");
  });
});

describe("checkCacheDirPerms", () => {
  test("OK when dir is 0o700", () => {
    const r = checkCacheDirPerms(happyEnv());
    expect(r.status).toBe("ok");
  });

  test("INFO when dir not yet created", () => {
    const r = checkCacheDirPerms(happyEnv({ existsSync: () => false }));
    expect(r.status).toBe("info");
    expect(r.message).toContain("not yet created");
  });

  test("WARN when perms are wider than 0o700", () => {
    // 0o755 has read/exec bits for group + other.
    const r = checkCacheDirPerms(happyEnv({ statMode: () => 0o40755 }));
    expect(r.status).toBe("warn");
    expect(r.fix).toContain("chmod 700");
  });

  test("WARN when stat fails", () => {
    const r = checkCacheDirPerms(
      happyEnv({
        existsSync: () => true, // claim it exists
        statMode: () => undefined, // but stat fails
      }),
    );
    expect(r.status).toBe("warn");
  });

  test("INFO on win32 (POSIX perms not meaningful)", () => {
    const r = checkCacheDirPerms(
      happyEnv({
        platform: "win32",
        existsSync: () => true,
      }),
    );
    expect(r.status).toBe("info");
  });
});

describe("checkEffortLevelEnv", () => {
  test("OK when CLAUDE_CODE_EFFORT_LEVEL unset", () => {
    const r = checkEffortLevelEnv(happyEnv({ envVars: {} }));
    expect(r.status).toBe("ok");
  });

  test("WARN when CLAUDE_CODE_EFFORT_LEVEL=max in env (THE bug we hit)", () => {
    const r = checkEffortLevelEnv(
      happyEnv({ envVars: { CLAUDE_CODE_EFFORT_LEVEL: "max" } }),
    );
    expect(r.status).toBe("warn");
    expect(r.message).toContain("CLAUDE_CODE_EFFORT_LEVEL=max");
    expect(r.fix).toContain("/model");
    expect(r.fix).toContain("shell rc");
  });

  test("WARN even for a non-max value (still overrides settings)", () => {
    const r = checkEffortLevelEnv(
      happyEnv({ envVars: { CLAUDE_CODE_EFFORT_LEVEL: "low" } }),
    );
    expect(r.status).toBe("warn");
    expect(r.message).toContain("low");
  });

  test("OK on empty string (treated as unset)", () => {
    const r = checkEffortLevelEnv(
      happyEnv({ envVars: { CLAUDE_CODE_EFFORT_LEVEL: "" } }),
    );
    expect(r.status).toBe("ok");
  });
});

describe("checkEffortLevelSetting", () => {
  test("OK when value is one of the known levels", () => {
    for (const level of ["max", "xhigh", "high", "medium", "low"]) {
      const r = checkEffortLevelSetting(
        happyEnv({
          readSettings: () => ({
            statusLine: { type: "command", command: "claudeline render" },
            effortLevel: level,
          }),
        }),
      );
      expect(r.status).toBe("ok");
      expect(r.message).toContain(level);
    }
  });

  test("INFO when no effortLevel set", () => {
    const r = checkEffortLevelSetting(
      happyEnv({
        readSettings: () => ({
          statusLine: { type: "command", command: "claudeline render" },
        }),
      }),
    );
    expect(r.status).toBe("info");
  });

  test("ERROR when value is not a known level", () => {
    const r = checkEffortLevelSetting(
      happyEnv({
        readSettings: () => ({
          statusLine: { type: "command", command: "claudeline render" },
          effortLevel: "ultra",
        }),
      }),
    );
    expect(r.status).toBe("error");
    expect(r.message).toContain("ultra");
    expect(r.fix).toContain("max");
  });
});

describe("checkStdinSchema", () => {
  test("OK on a fully-populated synthetic payload", () => {
    const r = checkStdinSchema();
    expect(r.status).toBe("ok");
  });

  test("ERROR on a payload that violates the schema", () => {
    // Wrong types — used_percentage is required to be a number.
    const r = checkStdinSchema({
      context_window: { used_percentage: "garbage" },
    });
    expect(r.status).toBe("error");
    expect(r.fix).toContain("build bug");
  });
});

describe("checkCacheShape", () => {
  test("OK when cache contents parse cleanly", () => {
    const r = checkCacheShape(happyEnv());
    expect(r.status).toBe("ok");
  });

  test("INFO when no cache file yet", () => {
    const r = checkCacheShape(happyEnv({ cacheExists: () => false }));
    expect(r.status).toBe("info");
  });

  test("WARN when cache exists but cannot be read (malformed JSON or rejected symlink)", () => {
    // Doctor passes Infinity as the TTL, so undefined-from-loadJson can
    // only mean malformed JSON, a symlink rejection, or a read failure —
    // never freshness. We surface that as a warning with a fix string.
    const r = checkCacheShape(
      happyEnv({
        cacheExists: () => true,
        cacheLoadRaw: () => undefined,
      }),
    );
    expect(r.status).toBe("warn");
    expect(r.message).toContain("unreadable");
    expect(r.fix).toContain("usage-cache.json");
  });

  test("WARN on pre-0.2 cache shape (no .data wrapper)", () => {
    const r = checkCacheShape(
      happyEnv({
        cacheExists: () => true,
        cacheLoadRaw: () => ({ five_hour: { utilization: 5 } }),
      }),
    );
    expect(r.status).toBe("warn");
    expect(r.message).toContain("Stale cache");
  });

  test("WARN on a malformed entry (data is an array)", () => {
    const r = checkCacheShape(
      happyEnv({
        cacheExists: () => true,
        cacheLoadRaw: () => ({ data: [1, 2], latencyMs: 100 }),
      }),
    );
    expect(r.status).toBe("warn");
  });
});

describe("checkStateShape", () => {
  test("OK when state has a fiveHour entry", () => {
    const r = checkStateShape(happyEnv());
    expect(r.status).toBe("ok");
  });

  test("INFO when state file missing", () => {
    const r = checkStateShape(happyEnv({ stateExists: () => false }));
    expect(r.status).toBe("info");
  });

  test("WARN when state file exists but parses to empty (old shape)", () => {
    const r = checkStateShape(
      happyEnv({ stateExists: () => true, stateLoad: () => ({}) }),
    );
    expect(r.status).toBe("warn");
    expect(r.fix).toContain("Safe to delete");
  });
});

describe("checkEngine", () => {
  test("info-level with Node only", () => {
    const r = checkEngine(happyEnv({ nodeVersion: "20.10.0" }));
    expect(r.status).toBe("info");
    expect(r.message).toContain("Node 20.10.0");
    expect(r.message).not.toContain("Bun");
  });

  test("info-level with Node + Bun when Bun present", () => {
    const r = checkEngine(
      happyEnv({ nodeVersion: "20.10.0", bunVersion: "1.3.11" }),
    );
    expect(r.message).toContain("Node 20.10.0");
    expect(r.message).toContain("Bun 1.3.11");
  });
});

describe("cacheDirFor", () => {
  test("uses uid-suffixed path under tmpdir", () => {
    expect(cacheDirFor(happyEnv())).toBe("/tmp/claudeline-501");
  });

  test("falls back to 'shared' when uid unset", () => {
    const env = happyEnv({ userInfo: {} });
    expect(cacheDirFor(env)).toBe("/tmp/claudeline-shared");
  });
});

describe("runDoctor (composition)", () => {
  test("happy path: every check passes or info, summary has 0 errors and 0 warnings", () => {
    const report = runDoctor(happyEnv());
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
    // We expect at least 6 ok lines from the canonical happy env;
    // the rest are info (engine, etc.).
    expect(report.summary.ok).toBeGreaterThanOrEqual(6);
  });

  test("everything broken: multiple warnings/errors fire and summary counts them", () => {
    const broken = happyEnv({
      // statusLine missing -> error
      readSettings: () => ({ effortLevel: "ultra" /* unknown -> error */ }),
      // CLAUDE_CODE_EFFORT_LEVEL set -> warn
      envVars: { CLAUDE_CODE_EFFORT_LEVEL: "max" },
      // cache dir wider perms -> warn
      statMode: () => 0o40755,
      // stale cache -> warn
      cacheLoadRaw: () => ({ five_hour: { utilization: 5 } }),
      // state file empty -> warn
      stateLoad: () => ({}),
    });
    const report = runDoctor(broken);
    expect(report.summary.errors).toBeGreaterThanOrEqual(2);
    expect(report.summary.warnings).toBeGreaterThanOrEqual(4);
  });

  test("returned lines are in the expected check order", () => {
    const report = runDoctor(happyEnv());
    // Spot-check: status line first, engine info towards the end.
    expect(report.lines[0]?.message).toContain("statusLine");
    const last = report.lines[report.lines.length - 1];
    // Either the version check (ok) or engine (info) closes the run.
    expect(last?.message).toMatch(/(claudeline|Node)/);
  });
});

describe("printReport", () => {
  test("happy path output contains check labels and summary", () => {
    const report = runDoctor(happyEnv());
    const printed = stripAnsi(printReport(report));
    expect(printed).toContain("claudeline doctor");
    expect(printed).toContain("statusLine wired");
    expect(printed).toContain("Cache directory exists");
    expect(printed).toContain("Summary:");
    expect(printed).toContain("0 warnings");
    expect(printed).toContain("0 errors");
  });

  test("warning case includes the indented action item", () => {
    const env = happyEnv({
      envVars: { CLAUDE_CODE_EFFORT_LEVEL: "max" },
    });
    const report = runDoctor(env);
    const printed = stripAnsi(printReport(report));
    expect(printed).toContain("CLAUDE_CODE_EFFORT_LEVEL=max");
    expect(printed).toContain("-> ");
    expect(printed).toContain("/model");
  });

  test("status icon prefixes are present for each line", () => {
    const env = happyEnv({
      envVars: { CLAUDE_CODE_EFFORT_LEVEL: "max" },
    });
    const report: DoctorReport = runDoctor(env);
    const printed = printReport(report);
    expect(printed).toContain("✅");
    expect(printed).toContain("⚠️");
  });

  test("error icon present on error case", () => {
    const env = happyEnv({ readSettings: () => ({}) });
    const report = runDoctor(env);
    const printed = printReport(report);
    expect(printed).toContain("❌");
  });
});
