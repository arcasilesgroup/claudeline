import { describe, expect, test } from "bun:test";
import { glyphsFor } from "../src/glyphs.js";
import { buildBar } from "../src/progress.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const emoji = glyphsFor("emoji");
const plain = glyphsFor("plain");

describe("buildBar", () => {
  test("0% renders all empty circles", () => {
    expect(stripAnsi(buildBar(0, 10, emoji))).toBe("○".repeat(10));
  });

  test("100% renders all filled", () => {
    expect(stripAnsi(buildBar(100, 10, emoji))).toBe("●".repeat(10));
  });

  test("50% on width 10 renders 5 filled + 5 empty", () => {
    expect(stripAnsi(buildBar(50, 10, emoji))).toBe(
      "●".repeat(5) + "○".repeat(5),
    );
  });

  test("clamps negatives to 0", () => {
    expect(stripAnsi(buildBar(-20, 10, emoji))).toBe("○".repeat(10));
  });

  test("clamps above 100 to 100", () => {
    expect(stripAnsi(buildBar(180, 10, emoji))).toBe("●".repeat(10));
  });

  test("uses red for high pct", () => {
    expect(buildBar(95, 5, emoji)).toContain("\x1b[38;2;255;85;85m");
  });

  test("uses green for low pct", () => {
    expect(buildBar(10, 5, emoji)).toContain("\x1b[38;2;0;175;80m");
  });

  test("plain mode uses # and . cells", () => {
    expect(stripAnsi(buildBar(50, 10, plain))).toBe("#".repeat(5) + ".".repeat(5));
  });
});
