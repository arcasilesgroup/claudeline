import { describe, expect, test } from "bun:test";
import { renderStatusline, type RenderDeps } from "../src/render.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function mockDeps(overrides: Partial<RenderDeps> = {}): RenderDeps {
  return {
    readSettings: () => ({}),
    getGitInfo: () => ({ branch: undefined, dirty: false }),
    detect24Hour: true,
    timeZone: "Europe/Madrid",
    now: () => new Date("2026-04-26T20:00:00Z").getTime(),
    skipPermissions: false,
    fetchUsage: async () => undefined,
    loadToken: () => undefined,
    cacheLoad: () => undefined,
    cacheSave: () => {},
    ...overrides,
  };
}

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
        getGitInfo: () => ({ branch: "feature/x", dirty: true }),
      }),
    );
    expect(stripAnsi(out)).toContain("repo (feature/x*)");
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
            five_hour: {
              utilization: 7,
              resets_at: "2026-04-26T22:30:00Z",
            },
            seven_day: {
              utilization: 21,
              resets_at: "2026-05-01T22:00:00Z",
            },
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
});
