import { describe, expect, test } from "bun:test";
import { glyphsFor } from "../src/glyphs.js";
import {
  type CachedUsage,
  type RenderDeps,
  nextMonthFirstEpoch,
  renderStatusline,
  renderStatuslineData,
} from "../src/render.js";
import type { RateState } from "../src/state.js";
import { mockDeps, stripAnsi } from "./_mockDeps.js";

describe("renderStatusline", () => {
  test("renders the basic line with model, context, dir, session, effort, thinking", async () => {
    const out = await renderStatusline(
      {
        model: { display_name: "Opus 4.7" },
        cwd: "/users/x/repos/claudeline",
        session: { start_time: "2026-04-26T17:00:00Z" },
        context_window: {
          context_window_size: 1_000_000,
          current_usage: {
            input_tokens: 50_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 100_000,
          },
        },
        effort: { level: "max" },
        thinking: { enabled: true },
      },
      mockDeps(),
    );

    const plain = stripAnsi(out);
    expect(plain).toContain("Opus 4.7");
    expect(plain).toContain("✍️ 15%");
    expect(plain).toContain("claudeline");
    expect(plain).toContain("⏱ 3h");
    expect(plain).toContain("◉ max");
    expect(plain).toContain("🧠");
  });

  test("uses git branch from injected info", async () => {
    const out = await renderStatusline(
      { cwd: "/p/repo" },
      mockDeps({
        getGitInfo: () => ({ branch: "feature/x", dirty: true, worktree: false }),
      }),
    );
    expect(stripAnsi(out)).toContain("repo (feature/x*)");
  });

  test("worktree marker shows when in a linked worktree", async () => {
    const out = await renderStatusline(
      { cwd: "/p/repo" },
      mockDeps({
        getGitInfo: () => ({ branch: "feat/x", dirty: false, worktree: true }),
      }),
    );
    expect(stripAnsi(out)).toContain("⎇:feat/x");
  });

  test("falls back to settings.json effortLevel when stdin empty", async () => {
    const out = await renderStatusline(
      { cwd: "/p/repo" },
      mockDeps({ readSettings: () => ({ effortLevel: "high" }) }),
    );
    expect(stripAnsi(out)).toContain("● high");
  });

  test("uses stdin .effort.level over settings", async () => {
    const out = await renderStatusline(
      { cwd: "/p/repo", effort: { level: "max" } },
      mockDeps({ readSettings: () => ({ effortLevel: "high" }) }),
    );
    expect(stripAnsi(out)).toContain("◉ max");
  });

  test("renders rate limits from stdin", async () => {
    const out = await renderStatusline(
      {
        cwd: "/p/repo",
        rate_limits: {
          five_hour: { used_percentage: 18, resets_at: "2026-04-26T22:30:00Z" },
          seven_day: { used_percentage: 42, resets_at: "2026-05-01T22:00:00Z" },
        },
      },
      mockDeps(),
    );
    const plain = stripAnsi(out);
    expect(plain).toContain("current");
    expect(plain).toContain("18%");
    expect(plain).toContain("weekly");
    expect(plain).toContain("42%");
  });

  test("falls back to fetchUsage when stdin lacks rate limits", async () => {
    let fetchedWithToken: string | undefined;
    const out = await renderStatusline(
      { cwd: "/p/repo" },
      mockDeps({
        loadToken: () => "tok-xyz",
        fetchUsage: async (tok) => {
          fetchedWithToken = tok;
          return {
            data: {
              five_hour: {
                utilization: 7,
                resets_at: "2026-04-26T22:30:00Z",
              },
              seven_day: {
                utilization: 21,
                resets_at: "2026-05-01T22:00:00Z",
              },
            },
            latencyMs: 230,
          };
        },
      }),
    );
    expect(fetchedWithToken).toBe("tok-xyz");
    expect(stripAnsi(out)).toContain("7%");
    expect(stripAnsi(out)).toContain("21%");
  });

  test("does not call API when stdin has rate limits", async () => {
    let called = false;
    await renderStatusline(
      {
        cwd: "/p/repo",
        rate_limits: {
          five_hour: { used_percentage: 1, resets_at: "2026-04-26T22:30:00Z" },
        },
      },
      mockDeps({
        loadToken: () => "tok",
        fetchUsage: async () => {
          called = true;
          return undefined;
        },
      }),
    );
    expect(called).toBe(false);
  });

  test("default to Claude when no model name", async () => {
    const out = await renderStatusline({ cwd: "/p/repo" }, mockDeps());
    expect(stripAnsi(out)).toContain("Claude");
  });

  test("null fields in stdin do not collapse the line", async () => {
    const out = await renderStatusline(
      {
        model: { display_name: "Opus" },
        cwd: "/p/repo",
        effort: { level: null },
        thinking: { enabled: null },
        session: { start_time: null },
      } as never,
      mockDeps(),
    );
    expect(stripAnsi(out)).toContain("Opus");
    expect(stripAnsi(out)).toContain("repo");
  });

  test("renders extra_usage with TZ-aware reset month", async () => {
    const out = await renderStatusline(
      { cwd: "/p/repo" },
      mockDeps({
        now: () => new Date("2026-04-26T20:00:00Z").getTime(),
        loadToken: () => "tok",
        fetchUsage: async () => ({
          data: {
            extra_usage: {
              is_enabled: true,
              utilization: 25,
              used_credits: 250,
              monthly_limit: 1000,
            },
          },
          latencyMs: 100,
        }),
      }),
    );
    const plain = stripAnsi(out);
    expect(plain).toContain("extra");
    expect(plain).toContain("$2.50");
    expect(plain).toContain("$10.00");
    expect(plain).toContain("1 may");
  });

  test("renders cost segment when model has known pricing", async () => {
    const out = await renderStatusline(
      {
        model: { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6" },
        cwd: "/p/repo",
        context_window: {
          current_usage: {
            input_tokens: 100_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 10_000,
          },
        },
      },
      mockDeps(),
    );
    expect(stripAnsi(out)).toContain("💸");
  });

  test("hides cost segment when model has no pricing", async () => {
    const out = await renderStatusline(
      {
        model: { id: "gpt-4" },
        cwd: "/p/repo",
        context_window: {
          current_usage: { input_tokens: 100_000 },
        },
      },
      mockDeps(),
    );
    expect(stripAnsi(out)).not.toContain("💸");
  });

  test("hides cost segment when token totals are zero with valid pricing", async () => {
    const out = await renderStatusline(
      {
        model: { id: "claude-sonnet-4-6" },
        cwd: "/p",
        context_window: {
          current_usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
      mockDeps(),
    );
    expect(stripAnsi(out)).not.toContain("💸");
  });

  test("cost segment sums all four token columns through real pricing", async () => {
    const out = await renderStatusline(
      {
        model: { id: "claude-sonnet-4-6" },
        cwd: "/p",
        context_window: {
          current_usage: {
            input_tokens: 1_000_000,
            cache_creation_input_tokens: 1_000_000,
            cache_read_input_tokens: 1_000_000,
            output_tokens: 1_000_000,
          },
        },
      },
      mockDeps(),
    );
    // Sonnet: 1M*$3 + 1M*$3.75 + 1M*$0.30 + 1M*$15 = $22.05
    expect(stripAnsi(out)).toContain("$22.05");
  });

  test("renders latency badge when API latency exceeds threshold", async () => {
    const out = await renderStatusline(
      { cwd: "/p/repo" },
      mockDeps({
        loadToken: () => "tok",
        fetchUsage: async () => ({
          data: {
            five_hour: { utilization: 5, resets_at: "2026-04-26T22:30:00Z" },
          },
          latencyMs: 1500,
        }),
      }),
    );
    expect(stripAnsi(out)).toContain("🐢 1500ms");
  });

  test("persists latency samples and renders p50/p99 once history is sufficient", async () => {
    let savedState: RateState = {};
    let cached: import("../src/render.js").CachedUsage | undefined;
    let nowMs = 1_000_000_000_000;
    // Use varying latencies so p50 ≠ p99 — a constant value would let an
    // implementation that returned `last sample` instead of computed
    // percentiles still pass.
    const samplesMs = [1200, 1400, 1600, 1800, 2000, 5000];
    let i = 0;
    const fetchUsage = async () =>
      ({
        data: {
          five_hour: { utilization: 5, resets_at: "2026-04-26T22:30:00Z" },
        },
        latencyMs: samplesMs[i++]!,
      }) as const;

    const buildDeps = (): RenderDeps => ({
      ...mockDeps(),
      now: () => nowMs,
      loadToken: () => "tok",
      fetchUsage,
      // Pretend the cache is always 0ms old: we want the test to
      // exercise the "no SWR" path here so the latency-percentile
      // assertions stay deterministic.
      cacheLoad: () => (cached ? { cache: cached, ageMs: 0 } : undefined),
      cacheSave: (c) => {
        cached = c;
      },
      loadState: () => savedState,
      saveState: (s) => {
        savedState = s;
      },
    });

    // First fetch — one sample, no percentile parenthetical (need ≥5).
    const out1 = await renderStatusline({ cwd: "/p" }, buildDeps());
    expect(stripAnsi(out1)).toContain("🐢 1200ms");
    expect(stripAnsi(out1)).not.toContain("p50:");
    expect(savedState.latencySamples).toHaveLength(1);

    // Three more fetches → 4 samples; still no parenthetical.
    for (let n = 0; n < 3; n++) {
      cached = undefined;
      nowMs += 60_000;
      await renderStatusline({ cwd: "/p" }, buildDeps());
    }
    expect(savedState.latencySamples).toHaveLength(4);

    // Fifth fetch — exactly 5 samples (the boundary). Parenthetical
    // should appear from this render onward.
    cached = undefined;
    nowMs += 60_000;
    const outFifth = await renderStatusline({ cwd: "/p" }, buildDeps());
    const plainFifth = stripAnsi(outFifth);
    expect(savedState.latencySamples).toHaveLength(5);
    expect(plainFifth).toContain("🐢 2000ms");
    // Sorted [1200,1400,1600,1800,2000] — p50: ceil(0.5*5)=3 → idx 2 → 1600.
    //                                       p99: ceil(0.99*5)=5 → idx 4 → 2000.
    expect(plainFifth).toContain("(p50:1600/p99:2000)");

    // Sixth fetch — outlier 5000ms drags p99 up; p50 only nudges.
    cached = undefined;
    nowMs += 60_000;
    const outSixth = await renderStatusline({ cwd: "/p" }, buildDeps());
    const plainSixth = stripAnsi(outSixth);
    expect(plainSixth).toContain("🐢 5000ms");
    // Sorted [1200,1400,1600,1800,2000,5000] — p50: ceil(0.5*6)=3 → idx 2 → 1600.
    //                                          p99: ceil(0.99*6)=6 → idx 5 → 5000.
    expect(plainSixth).toContain("(p50:1600/p99:5000)");
  });

  test("latency summary not shown when stdin already has rate limits", async () => {
    let savedState: RateState = {
      latencySamples: Array.from({ length: 10 }, (_, i) => ({
        ms: 1500,
        epoch: 1000 + i,
      })),
    };
    const out = await renderStatusline(
      {
        cwd: "/p",
        rate_limits: {
          five_hour: { used_percentage: 5, resets_at: "2026-04-26T22:30:00Z" },
        },
      },
      mockDeps({
        loadState: () => savedState,
        saveState: (s) => {
          savedState = s;
        },
      }),
    );
    // No new fetch happened, so no latency badge at all.
    expect(stripAnsi(out)).not.toContain("🐢");
    expect(stripAnsi(out)).not.toContain("p50:");
  });

  test("does not render latency badge below threshold", async () => {
    const out = await renderStatusline(
      { cwd: "/p/repo" },
      mockDeps({
        loadToken: () => "tok",
        fetchUsage: async () => ({
          data: {
            five_hour: { utilization: 5, resets_at: "2026-04-26T22:30:00Z" },
          },
          latencyMs: 200,
        }),
      }),
    );
    expect(stripAnsi(out)).not.toContain("ms");
  });

  test("rate-limit projection persists across renders", async () => {
    let savedState: RateState = {};
    const baseDeps = (now: number): RenderDeps => ({
      ...mockDeps(),
      now: () => now,
      loadState: () => savedState,
      saveState: (s) => {
        savedState = s;
      },
    });

    // First render at t=0, 50% used. No previous sample → no projection.
    const out1 = await renderStatusline(
      {
        cwd: "/p",
        rate_limits: {
          five_hour: { used_percentage: 50, resets_at: "2026-04-26T22:30:00Z" },
        },
      },
      baseDeps(1_000_000_000),
    );
    expect(stripAnsi(out1)).not.toMatch(/~\d+m/);
    expect(savedState.fiveHour?.pct).toBe(50);

    // Second render 60s later, 60% used → +10% / 60s = 10%/min, 40 left → 4 min.
    const out = await renderStatusline(
      {
        cwd: "/p",
        rate_limits: {
          five_hour: { used_percentage: 60, resets_at: "2026-04-26T22:30:00Z" },
        },
      },
      baseDeps(1_000_060_000),
    );
    expect(stripAnsi(out)).toContain("~4m");
  });

  test("projectAndPersistFiveHour skipped when there is no rate window", async () => {
    let loadCount = 0;
    let saveCount = 0;
    let store: RateState = {};
    await renderStatusline(
      { cwd: "/p" }, // no rate_limits, no token
      mockDeps({
        loadState: () => {
          loadCount++;
          return store;
        },
        saveState: (s) => {
          saveCount++;
          store = s;
        },
      }),
    );
    expect(loadCount).toBe(0);
    expect(saveCount).toBe(0);
  });

  test("renders fast mode and 1M context badges when stdin flags them", async () => {
    const out = await renderStatusline(
      {
        cwd: "/p",
        fast_mode: true,
        exceeds_200k_tokens: true,
      } as never,
      mockDeps(),
    );
    const plain = stripAnsi(out);
    expect(plain).toContain("🐇");
    expect(plain).toContain("📚");
  });

  test("plain glyph mode renders ASCII bar cells", async () => {
    const out = await renderStatusline(
      {
        cwd: "/p",
        rate_limits: {
          five_hour: { used_percentage: 50, resets_at: "2026-04-26T22:30:00Z" },
        },
      },
      mockDeps({ glyphs: glyphsFor("plain") }),
    );
    const plain = stripAnsi(out);
    expect(plain).toContain("#####");
    expect(plain).toContain(".....");
    expect(plain).toContain("ctx:");
  });
});

describe("nextMonthFirstEpoch", () => {
  test("UTC midnight crossover: server in LA, user in Madrid, May 1 in TZ but Apr 30 server", () => {
    const ms = new Date("2026-05-01T00:30:00Z").getTime();
    const epochMadrid = nextMonthFirstEpoch(ms, "Europe/Madrid");
    expect(epochMadrid).toBe(Math.floor(Date.UTC(2026, 5, 1) / 1000));
  });

  test("December rolls into next year January", () => {
    const ms = new Date("2026-12-15T12:00:00Z").getTime();
    const epoch = nextMonthFirstEpoch(ms, "UTC");
    expect(epoch).toBe(Math.floor(Date.UTC(2027, 0, 1) / 1000));
  });

  test("no timeZone falls back to server-local", () => {
    const ms = new Date("2026-04-15T12:00:00Z").getTime();
    const epoch = nextMonthFirstEpoch(ms, undefined);
    const expected = new Date(2026, 4, 1);
    expect(epoch).toBe(Math.floor(expected.getTime() / 1000));
  });
});

// Re-export helper type so the linter sees it used.
type _CachedUsage = CachedUsage;

describe("renderStatuslineData (--json output)", () => {
  test("emits a structured snapshot of model/cost/context/session", async () => {
    const data = await renderStatuslineData(
      {
        model: { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
        session: { id: "abc123", start_time: "2026-04-26T17:00:00Z" },
        cwd: "/tmp/repo",
        cost: { total_cost_usd: 1.42 },
        context_window: {
          context_window_size: 200_000,
          used_percentage: 25,
          current_usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 500,
            output_tokens: 200,
          },
        },
        effort: { level: "high" },
        thinking: { enabled: true },
        fast_mode: true,
      },
      mockDeps(),
      { version: "9.9.9" },
    );

    expect(data.version).toBe("9.9.9");
    expect(data.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.model.id).toBe("claude-sonnet-4-6");
    expect(data.model.display_name).toBe("Claude Sonnet 4.6");
    expect(data.session.id).toBe("abc123");
    expect(data.session.elapsed_seconds).toBeGreaterThan(0);
    expect(data.cost.total_usd).toBe(1.42);
    expect(data.cost.source).toBe("server");
    expect(data.context.used_percentage).toBe(25);
    expect(data.context.window_size).toBe(200_000);
    expect(data.context.tokens.input).toBe(1000);
    expect(data.effort.level).toBe("high");
    expect(data.thinking.enabled).toBe(true);
    expect(data.flags.fast_mode).toBe(true);
    expect(data.flags.exceeds_200k_tokens).toBe(false);
    expect(data.directory.cwd).toBe("/tmp/repo");
  });

  test("derives cost from tokens × pricing when no server cost", async () => {
    const data = await renderStatuslineData(
      {
        model: { id: "claude-opus-4-1", display_name: "Opus 4.1" },
        cwd: "/tmp",
        // No `cost` field — exercise the estimation branch.
        context_window: {
          current_usage: {
            input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 100_000,
          },
        },
      },
      mockDeps(),
      { version: "9.9.9" },
    );

    expect(data.cost.source).toBe("estimated");
    expect(typeof data.cost.total_usd).toBe("number");
    expect(data.cost.total_usd).toBeGreaterThan(0);
  });

  test("rate_limits.five_hour comes from stdin payload when present", async () => {
    const data = await renderStatuslineData(
      {
        model: { display_name: "Sonnet" },
        cwd: "/tmp",
        rate_limits: {
          five_hour: { used_percentage: 42, resets_at: "2026-04-27T13:20:00Z" },
          seven_day: { used_percentage: 18, resets_at: "2026-05-01T00:00:00Z" },
        },
      },
      mockDeps(),
      { version: "9.9.9" },
    );

    expect(data.rate_limits.five_hour?.pct).toBe(42);
    expect(data.rate_limits.five_hour?.resets_at_epoch).toBe(
      Math.floor(new Date("2026-04-27T13:20:00Z").getTime() / 1000),
    );
    expect(data.rate_limits.seven_day?.pct).toBe(18);
  });

  test("nulls out missing fields rather than omitting them", async () => {
    const data = await renderStatuslineData(
      { model: { display_name: "Sonnet" }, cwd: "/tmp" },
      mockDeps(),
      { version: "9.9.9" },
    );

    // Schema stays stable for editor consumers; absent → null, not undefined/missing key.
    expect(data.model.id).toBeNull();
    expect(data.cost.total_usd).toBeNull();
    expect(data.cost.source).toBeNull();
    expect(data.session.id).toBeNull();
    expect(data.session.elapsed_seconds).toBeNull();
    expect(data.effort.level).toBeNull();
    expect(data.context.used_percentage).toBeNull();
    expect(data.directory.git.branch).toBeNull();
    expect(data.rate_limits.five_hour).toBeNull();
    expect(data.latency.last_ms).toBeNull();
  });
});

describe("stale-while-revalidate cache path", () => {
  // Build a fake CachedUsage that the renderer will accept. Only the
  // shape matters; the actual values don't drive the SWR branching we
  // care about here.
  const fakeCache: import("../src/render.js").CachedUsage = {
    data: {
      five_hour: { utilization: 50, resets_at: "2026-04-26T22:30:00Z" },
    },
    latencyMs: 100,
  };

  test("fresh cache (age < SWR threshold) does NOT call refreshInBackground", async () => {
    let bgCalls = 0;
    const fetched: { calls: number } = { calls: 0 };
    await renderStatusline(
      { cwd: "/tmp" },
      {
        ...mockDeps(),
        loadToken: () => "tok",
        fetchUsage: async () => {
          fetched.calls += 1;
          return undefined;
        },
        cacheLoad: () => ({ cache: fakeCache, ageMs: 2_000 }),
        refreshInBackground: () => {
          bgCalls += 1;
        },
      },
    );
    expect(bgCalls).toBe(0);
    expect(fetched.calls).toBe(0); // fresh cache → no sync fetch either
  });

  test("stale cache (age > SWR threshold) calls refreshInBackground but skips sync fetch", async () => {
    let bgCalls = 0;
    let syncFetches = 0;
    await renderStatusline(
      { cwd: "/tmp" },
      {
        ...mockDeps(),
        loadToken: () => "tok",
        fetchUsage: async () => {
          syncFetches += 1;
          return undefined;
        },
        // 10s old: past the 5s SWR threshold but within typical TTL.
        cacheLoad: () => ({ cache: fakeCache, ageMs: 10_000 }),
        refreshInBackground: () => {
          bgCalls += 1;
        },
      },
    );
    expect(bgCalls).toBe(1);
    expect(syncFetches).toBe(0); // we served the cached data, didn't block
  });

  test("missing cache (cli wired returned undefined) falls back to sync fetch", async () => {
    let bgCalls = 0;
    let syncFetches = 0;
    await renderStatusline(
      { cwd: "/tmp" },
      {
        ...mockDeps(),
        loadToken: () => "tok",
        fetchUsage: async () => {
          syncFetches += 1;
          return undefined;
        },
        cacheLoad: () => undefined, // beyond TTL or never cached
        refreshInBackground: () => {
          bgCalls += 1;
        },
      },
    );
    expect(syncFetches).toBe(1); // we fetched synchronously
    expect(bgCalls).toBe(0); // no SWR spawn — we already have fresh data
  });

  test("renderStatusline tolerates missing refreshInBackground (older callers / tests)", async () => {
    // Behaves like cache-fresh-no-deps: serve cached, no spawn attempted.
    const out = await renderStatusline(
      { cwd: "/tmp" },
      {
        ...mockDeps(),
        loadToken: () => "tok",
        fetchUsage: async () => undefined,
        cacheLoad: () => ({ cache: fakeCache, ageMs: 20_000 }),
        // refreshInBackground intentionally omitted.
      },
    );
    expect(typeof out).toBe("string");
    // Doesn't crash; the lack of bg refresh is silently absorbed.
  });
});
