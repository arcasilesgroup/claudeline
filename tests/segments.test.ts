import { describe, expect, test } from "bun:test";
import { palette, RESET, style } from "../src/ansi.js";
import { glyphsFor } from "../src/glyphs.js";
import {
  LONG_CONTEXT_MULTIPLIER,
  computeCost,
  contextSegment,
  costSegment,
  directorySegment,
  effortSegment,
  fastModeSegment,
  largeContextSegment,
  latencySegment,
  modelSegment,
  sessionSegment,
  thinkingSegment,
} from "../src/segments.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const emoji = glyphsFor("emoji");
const plain = glyphsFor("plain");

describe("modelSegment", () => {
  test("uses display_name when present", () => {
    expect(stripAnsi(modelSegment("Opus 4.7"))).toBe("Opus 4.7");
  });

  test("falls back to Claude when missing", () => {
    expect(stripAnsi(modelSegment(undefined))).toBe("Claude");
  });

  test("colored blue", () => {
    expect(modelSegment("Opus")).toContain(palette.blue);
  });
});

describe("contextSegment", () => {
  test("computes percentage from usage when used_percentage absent", () => {
    const out = contextSegment(
      {
        windowSize: 200_000,
        inputTokens: 50_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 50_000,
      },
      emoji,
    );
    expect(stripAnsi(out)).toBe("✍️ 50%");
  });

  test("prefers explicit used_percentage when provided", () => {
    const out = contextSegment(
      {
        windowSize: 200_000,
        inputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        usedPercentage: 73,
      },
      emoji,
    );
    expect(stripAnsi(out)).toBe("✍️ 73%");
  });

  test("zero windowSize gives 0%", () => {
    const out = contextSegment(
      {
        windowSize: 0,
        inputTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      emoji,
    );
    expect(stripAnsi(out)).toBe("✍️ 0%");
  });

  test("uses red color at 95%", () => {
    expect(
      contextSegment(
        {
          windowSize: 100,
          inputTokens: 95,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        emoji,
      ),
    ).toContain(palette.red);
  });

  test("plain mode uses ctx: prefix", () => {
    const out = contextSegment(
      {
        windowSize: 100,
        inputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      plain,
    );
    expect(stripAnsi(out)).toBe("ctx: 50%");
  });
});

describe("directorySegment", () => {
  test("renders basename", () => {
    expect(stripAnsi(directorySegment({ cwd: "/foo/bar/baz" }, emoji))).toBe(
      "baz",
    );
  });

  test("includes branch and dirty flag", () => {
    expect(
      stripAnsi(
        directorySegment(
          { cwd: "/foo/bar", gitBranch: "main", gitDirty: true },
          emoji,
        ),
      ),
    ).toBe("bar (main*)");
  });

  test("includes branch without asterisk when clean", () => {
    expect(
      stripAnsi(
        directorySegment(
          { cwd: "/foo/bar", gitBranch: "feature/x", gitDirty: false },
          emoji,
        ),
      ),
    ).toBe("bar (feature/x)");
  });

  test("prepends ⚡ when skipPermissions", () => {
    expect(
      stripAnsi(
        directorySegment({ cwd: "/foo/bar", skipPermissions: true }, emoji),
      ),
    ).toBe("⚡  bar");
  });

  test("Windows backslash path uses last segment", () => {
    expect(
      stripAnsi(directorySegment({ cwd: "C:\\Users\\x\\repo" }, emoji)),
    ).toBe("repo");
  });

  test("trailing slash trimmed", () => {
    expect(stripAnsi(directorySegment({ cwd: "/foo/bar/" }, emoji))).toBe(
      "bar",
    );
  });

  test("strips ANSI/control characters from cwd", () => {
    const out = directorySegment({ cwd: "/foo/\x1b]0;PWNED\x07bar" }, emoji);
    const stripped = stripAnsi(out);
    expect(stripped).not.toContain("\x07");
    expect(stripped).not.toContain("\x1b");
    expect(stripped).toContain("PWNED");
  });

  test("strips control characters from git branch", () => {
    const out = directorySegment(
      {
        cwd: "/x",
        gitBranch: "main\x1b]8;;file:///etc/passwd\x1b\\",
      },
      emoji,
    );
    expect(stripAnsi(out)).not.toContain("\x1b");
  });

  test("worktree prefix when gitWorktree", () => {
    expect(
      stripAnsi(
        directorySegment(
          { cwd: "/foo/bar", gitBranch: "feat", gitWorktree: true },
          emoji,
        ),
      ),
    ).toBe("bar (⎇:feat)");
  });
});

describe("sessionSegment", () => {
  test("seconds when under a minute", () => {
    expect(stripAnsi(sessionSegment(45, emoji))).toBe("⏱ 45s");
  });

  test("minutes when 1m–59m", () => {
    expect(stripAnsi(sessionSegment(125, emoji))).toBe("⏱ 2m");
  });

  test("hours+minutes when 1h+", () => {
    expect(stripAnsi(sessionSegment(3 * 3600 + 47 * 60, emoji))).toBe(
      "⏱ 3h47m",
    );
  });

  test("returns empty for invalid duration", () => {
    expect(sessionSegment(undefined, emoji)).toBe("");
    expect(sessionSegment(-10, emoji)).toBe("");
  });

  test("plain mode prefix", () => {
    expect(stripAnsi(sessionSegment(60, plain))).toBe("t: 1m");
  });
});

describe("effortSegment", () => {
  test("max uses ◉ magenta", () => {
    const out = effortSegment("max", emoji);
    expect(stripAnsi(out)).toBe("◉ max");
    expect(out).toContain(palette.magenta);
  });

  test("xhigh uses ◉ magenta", () => {
    expect(stripAnsi(effortSegment("xhigh", emoji))).toBe("◉ xhigh");
  });

  test("ultra renders as 'ultracode' with ◉ magenta", () => {
    const out = effortSegment("ultra", emoji);
    expect(stripAnsi(out)).toBe("◉ ultracode");
    expect(out).toContain(palette.magenta);
  });

  test("ultra emits ASCII tokens in plain mode", () => {
    expect(stripAnsi(effortSegment("ultra", plain))).toBe("++ ultracode");
  });

  test("high uses ● magenta", () => {
    const out = effortSegment("high", emoji);
    expect(stripAnsi(out)).toBe("● high");
    expect(out).toContain(palette.magenta);
  });

  test("medium uses ◑ dim", () => {
    const out = effortSegment("medium", emoji);
    expect(stripAnsi(out)).toBe("◑ medium");
    expect(out).toContain(style.dim);
  });

  test("low uses ◔ dim", () => {
    expect(stripAnsi(effortSegment("low", emoji))).toBe("◔ low");
  });

  test("unknown falls back to ◑ name", () => {
    expect(stripAnsi(effortSegment("weird", emoji))).toBe("◑ weird");
  });

  test("undefined returns empty", () => {
    expect(effortSegment(undefined, emoji)).toBe("");
  });

  test("plain mode emits ASCII tokens", () => {
    expect(stripAnsi(effortSegment("max", plain))).toBe("++ max");
    expect(stripAnsi(effortSegment("low", plain))).toBe("- low");
  });
});

describe("thinkingSegment", () => {
  test("renders 🧠 in magenta when enabled", () => {
    const out = thinkingSegment(true, emoji);
    expect(stripAnsi(out)).toBe("🧠");
    expect(out).toContain(palette.magenta);
  });

  test("empty when disabled", () => {
    expect(thinkingSegment(false, emoji)).toBe("");
    expect(thinkingSegment(undefined, emoji)).toBe("");
  });

  test("plain mode renders [T]", () => {
    expect(stripAnsi(thinkingSegment(true, plain))).toBe("[T]");
  });
});

describe("costSegment", () => {
  const sonnetPricing = {
    input: 3,
    cacheCreation: 3.75,
    cacheRead: 0.3,
    output: 15,
  };

  test("returns empty when no pricing for model", () => {
    expect(
      costSegment(
        {
          modelId: "unknown",
          inputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 100,
        },
        undefined,
        emoji,
      ),
    ).toBe("");
  });

  test("renders dollars at >=1 with 2 decimals", () => {
    const out = costSegment(
      {
        modelId: "claude-sonnet",
        inputTokens: 500_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 50_000,
      },
      sonnetPricing,
      emoji,
    );
    // input: 0.5M * $3 = $1.50; output: 0.05M * $15 = $0.75; total = $2.25
    expect(stripAnsi(out)).toBe("💸 $2.25");
  });

  test("renders sub-dollar amounts with 3 decimals", () => {
    const out = costSegment(
      {
        modelId: "claude-sonnet",
        inputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 100,
      },
      sonnetPricing,
      emoji,
    );
    // 1000 * $3 / 1M + 100 * $15 / 1M = $0.0045 → toFixed(3) → "$0.005"
    expect(stripAnsi(out)).toMatch(/\$0\.\d{3}\b/);
  });

  test("returns empty when total is zero", () => {
    expect(
      stripAnsi(
        costSegment(
          {
            modelId: "claude-sonnet",
            inputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 0,
          },
          sonnetPricing,
          emoji,
        ),
      ),
    ).toBe("");
  });

  test("prefers totalCostUsd over local computation", () => {
    const out = costSegment(
      {
        totalCostUsd: 225.7886,
        modelId: "claude-sonnet",
        inputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 100,
      },
      sonnetPricing,
      emoji,
    );
    expect(stripAnsi(out)).toBe("💸 $225.79");
  });

  test("falls back to local pricing when totalCostUsd absent", () => {
    const out = costSegment(
      {
        modelId: "claude-sonnet",
        inputTokens: 500_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 50_000,
      },
      sonnetPricing,
      emoji,
    );
    // 0.5M*$3 + 0.05M*$15 = $2.25
    expect(stripAnsi(out)).toBe("💸 $2.25");
  });

  test("renders even when no pricing if totalCostUsd is supplied", () => {
    const out = costSegment(
      {
        totalCostUsd: 10.5,
        modelId: "unknown-model",
        inputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
      },
      undefined,
      emoji,
    );
    expect(stripAnsi(out)).toBe("💸 $10.50");
  });
});

describe("computeCost", () => {
  const price = {
    input: 3,
    cacheCreation: 3.75,
    cacheRead: 0.3,
    output: 15,
  };

  const base = {
    modelId: "x",
    inputTokens: 1_000_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
  };

  test("no surcharge at the 200k default context", () => {
    expect(computeCost({ ...base, contextWindowSize: 200_000 }, price)).toEqual(
      {
        dollars: 3,
        source: "estimated",
      },
    );
  });

  test("applies the 1M-context surcharge at 1_000_000", () => {
    const result = computeCost(
      { ...base, contextWindowSize: 1_000_000 },
      price,
    );
    expect(result?.dollars).toBeGreaterThan(3);
    expect(result).toEqual({
      dollars: 3 * LONG_CONTEXT_MULTIPLIER,
      source: "estimated",
    });
  });

  test("applies the surcharge when exceeds200k is true (window absent)", () => {
    const result = computeCost({ ...base, exceeds200k: true }, price);
    expect(result).toEqual({
      dollars: 3 * LONG_CONTEXT_MULTIPLIER,
      source: "estimated",
    });
  });

  test("server cost is authoritative and never re-surcharged", () => {
    expect(
      computeCost(
        { ...base, totalCostUsd: 10, contextWindowSize: 1_000_000 },
        price,
      ),
    ).toEqual({ dollars: 10, source: "server" });
  });

  test("returns null with no price and no server cost", () => {
    expect(computeCost(base, undefined)).toBeNull();
  });

  test("returns null when the estimate is zero", () => {
    expect(
      computeCost(
        {
          modelId: "x",
          inputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
        },
        price,
      ),
    ).toBeNull();
  });
});

describe("latencySegment", () => {
  test("returns empty under threshold", () => {
    expect(latencySegment(500, emoji)).toBe("");
    expect(latencySegment(undefined, emoji)).toBe("");
  });

  test("renders yellow between 1000 and 3000ms", () => {
    const out = latencySegment(1500, emoji);
    expect(stripAnsi(out)).toBe("🐢 1500ms");
    expect(out).toContain(palette.yellow);
  });

  test("renders red beyond 3000ms", () => {
    const out = latencySegment(3500, emoji);
    expect(out).toContain(palette.red);
  });

  test("plain mode prefix", () => {
    expect(stripAnsi(latencySegment(2000, plain))).toBe("lat: 2000ms");
  });

  test("renders at exactly 1000ms (boundary inclusive)", () => {
    // anchor
    expect(stripAnsi(latencySegment(1000, emoji))).toBe("🐢 1000ms");
  });

  test("at exactly 3000ms switches to red", () => {
    const out = latencySegment(3000, emoji);
    expect(out).toContain(palette.red);
  });

  test("renders summary parenthetical when supplied", () => {
    const out = latencySegment(230, emoji, 0, { p50: 180, p99: 550 });
    expect(stripAnsi(out)).toBe("🐢 230ms (p50:180/p99:550)");
  });

  test("ignores summary when latency is below threshold", () => {
    expect(latencySegment(500, emoji, 1000, { p50: 100, p99: 999 })).toBe("");
  });

  test("plain mode renders summary parenthetical", () => {
    expect(
      stripAnsi(
        latencySegment(2000, plain, undefined, { p50: 700, p99: 2500 }),
      ),
    ).toBe("lat: 2000ms (p50:700/p99:2500)");
  });

  test("without summary keeps the original rendering", () => {
    expect(stripAnsi(latencySegment(1500, emoji))).toBe("🐢 1500ms");
  });
});

describe("fastModeSegment", () => {
  test("empty when disabled", () => {
    expect(fastModeSegment(false, emoji)).toBe("");
    expect(fastModeSegment(undefined, emoji)).toBe("");
    expect(fastModeSegment(null, emoji)).toBe("");
  });

  test("renders 🐇 when fast_mode true", () => {
    expect(stripAnsi(fastModeSegment(true, emoji))).toBe("🐇");
  });

  test("plain mode renders 'fast'", () => {
    expect(stripAnsi(fastModeSegment(true, plain))).toBe("fast");
  });
});

describe("largeContextSegment", () => {
  test("empty when not exceeding 200K", () => {
    expect(largeContextSegment(false, emoji)).toBe("");
    expect(largeContextSegment(undefined, emoji)).toBe("");
    expect(largeContextSegment(null, emoji)).toBe("");
  });

  test("renders 📚 when exceeds_200k_tokens true", () => {
    expect(stripAnsi(largeContextSegment(true, emoji))).toBe("📚");
  });

  test("plain mode renders '1M+'", () => {
    expect(stripAnsi(largeContextSegment(true, plain))).toBe("1M+");
  });
});

describe("RESET handling", () => {
  test("every non-empty segment ends in RESET", () => {
    const all = [
      modelSegment("X"),
      contextSegment(
        {
          windowSize: 1000,
          inputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        emoji,
      ),
      directorySegment({ cwd: "/a/b" }, emoji),
      sessionSegment(60, emoji),
      effortSegment("high", emoji),
      thinkingSegment(true, emoji),
      latencySegment(1500, emoji),
    ];
    for (const segment of all) {
      expect(segment.endsWith(RESET)).toBe(true);
    }
  });
});
