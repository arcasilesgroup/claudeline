import { describe, expect, test } from "bun:test";
import { palette, RESET, style } from "../src/ansi.js";
import {
  contextSegment,
  directorySegment,
  effortSegment,
  modelSegment,
  sessionSegment,
  thinkingSegment,
} from "../src/segments.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

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
    const out = contextSegment({
      windowSize: 200_000,
      inputTokens: 50_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 50_000,
    });
    expect(stripAnsi(out)).toBe("✍️ 50%");
  });

  test("prefers explicit used_percentage when provided", () => {
    const out = contextSegment({
      windowSize: 200_000,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      usedPercentage: 73,
    });
    expect(stripAnsi(out)).toBe("✍️ 73%");
  });

  test("zero windowSize gives 0%", () => {
    const out = contextSegment({
      windowSize: 0,
      inputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    expect(stripAnsi(out)).toBe("✍️ 0%");
  });

  test("uses red color at 95%", () => {
    expect(
      contextSegment({
        windowSize: 100,
        inputTokens: 95,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toContain(palette.red);
  });
});

describe("directorySegment", () => {
  test("renders basename", () => {
    expect(stripAnsi(directorySegment({ cwd: "/foo/bar/baz" }))).toBe("baz");
  });

  test("includes branch and dirty flag", () => {
    expect(
      stripAnsi(
        directorySegment({
          cwd: "/foo/bar",
          gitBranch: "main",
          gitDirty: true,
        }),
      ),
    ).toBe("bar (main*)");
  });

  test("includes branch without asterisk when clean", () => {
    expect(
      stripAnsi(
        directorySegment({
          cwd: "/foo/bar",
          gitBranch: "feature/x",
          gitDirty: false,
        }),
      ),
    ).toBe("bar (feature/x)");
  });

  test("prepends ⚡ when skipPermissions", () => {
    expect(
      stripAnsi(
        directorySegment({ cwd: "/foo/bar", skipPermissions: true }),
      ),
    ).toBe("⚡  bar");
  });

  test("Windows backslash path uses last segment", () => {
    expect(
      stripAnsi(directorySegment({ cwd: "C:\\Users\\x\\repo" })),
    ).toBe("repo");
  });

  test("trailing slash trimmed", () => {
    expect(stripAnsi(directorySegment({ cwd: "/foo/bar/" }))).toBe("bar");
  });

  test("strips ANSI/control characters from cwd", () => {
    const plain = stripAnsi(
      directorySegment({ cwd: "/foo/\x1b]0;PWNED\x07bar" }),
    );
    // BEL (\x07) and ESC (\x1b) from the malicious cwd are gone.
    expect(plain).not.toContain("\x07");
    expect(plain).not.toContain("\x1b");
    // The visible payload renders as literal characters (no escape effect).
    expect(plain).toContain("PWNED");
  });

  test("strips control characters from git branch", () => {
    const out = directorySegment({
      cwd: "/x",
      gitBranch: "main\x1b]8;;file:///etc/passwd\x1b\\",
    });
    expect(stripAnsi(out)).not.toContain("\x1b");
  });
});

describe("sessionSegment", () => {
  test("seconds when under a minute", () => {
    expect(stripAnsi(sessionSegment(45))).toBe("⏱ 45s");
  });

  test("minutes when 1m–59m", () => {
    expect(stripAnsi(sessionSegment(125))).toBe("⏱ 2m");
  });

  test("hours+minutes when 1h+", () => {
    expect(stripAnsi(sessionSegment(3 * 3600 + 47 * 60))).toBe("⏱ 3h47m");
  });

  test("returns empty for invalid duration", () => {
    expect(sessionSegment(undefined)).toBe("");
    expect(sessionSegment(-10)).toBe("");
  });
});

describe("effortSegment", () => {
  test("max uses ◉ magenta", () => {
    const out = effortSegment("max");
    expect(stripAnsi(out)).toBe("◉ max");
    expect(out).toContain(palette.magenta);
  });

  test("xhigh uses ◉ magenta", () => {
    expect(stripAnsi(effortSegment("xhigh"))).toBe("◉ xhigh");
  });

  test("high uses ● magenta", () => {
    const out = effortSegment("high");
    expect(stripAnsi(out)).toBe("● high");
    expect(out).toContain(palette.magenta);
  });

  test("medium uses ◑ dim", () => {
    const out = effortSegment("medium");
    expect(stripAnsi(out)).toBe("◑ medium");
    expect(out).toContain(style.dim);
  });

  test("low uses ◔ dim", () => {
    expect(stripAnsi(effortSegment("low"))).toBe("◔ low");
  });

  test("unknown falls back to ◑ name", () => {
    expect(stripAnsi(effortSegment("weird"))).toBe("◑ weird");
  });

  test("undefined returns empty", () => {
    expect(effortSegment(undefined)).toBe("");
  });
});

describe("thinkingSegment", () => {
  test("renders 🧠 in magenta when enabled", () => {
    const out = thinkingSegment(true);
    expect(stripAnsi(out)).toBe("🧠");
    expect(out).toContain(palette.magenta);
  });

  test("empty when disabled", () => {
    expect(thinkingSegment(false)).toBe("");
    expect(thinkingSegment(undefined)).toBe("");
  });
});

describe("RESET handling", () => {
  test("every non-empty segment ends in RESET", () => {
    const all = [
      modelSegment("X"),
      contextSegment({
        windowSize: 1000,
        inputTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
      directorySegment({ cwd: "/a/b" }),
      sessionSegment(60),
      effortSegment("high"),
      thinkingSegment(true),
    ];
    for (const segment of all) {
      expect(segment.endsWith(RESET)).toBe(true);
    }
  });
});
