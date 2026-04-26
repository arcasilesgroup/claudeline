import { describe, expect, test } from "bun:test";
import { color, colorForPercentage, paint, RESET, style } from "../src/ansi.js";

describe("color", () => {
  test("emits truecolor escape", () => {
    expect(color(0, 153, 255)).toBe("\x1b[38;2;0;153;255m");
  });
});

describe("style", () => {
  test("dim is SGR 2", () => {
    expect(style.dim).toBe("\x1b[2m");
  });
});

describe("paint", () => {
  test("wraps text with color and reset", () => {
    expect(paint("hello", color(255, 0, 0))).toBe(
      `\x1b[38;2;255;0;0mhello${RESET}`,
    );
  });
});

describe("colorForPercentage", () => {
  test("green below 50", () => {
    expect(colorForPercentage(0)).toBe(color(0, 175, 80));
    expect(colorForPercentage(49)).toBe(color(0, 175, 80));
  });
  test("orange 50–69", () => {
    expect(colorForPercentage(50)).toBe(color(255, 176, 85));
    expect(colorForPercentage(69)).toBe(color(255, 176, 85));
  });
  test("yellow 70–89", () => {
    expect(colorForPercentage(70)).toBe(color(230, 200, 0));
    expect(colorForPercentage(89)).toBe(color(230, 200, 0));
  });
  test("red 90+", () => {
    expect(colorForPercentage(90)).toBe(color(255, 85, 85));
    expect(colorForPercentage(150)).toBe(color(255, 85, 85));
  });
  test("treats negative as 0", () => {
    expect(colorForPercentage(-10)).toBe(color(0, 175, 80));
  });
});
