import { describe, expect, test } from "bun:test";
import { glyphsFor, parseGlyphMode } from "../src/glyphs.js";

describe("parseGlyphMode", () => {
  test("emoji default", () => {
    expect(parseGlyphMode(undefined)).toBe("emoji");
    expect(parseGlyphMode("")).toBe("emoji");
    expect(parseGlyphMode("anything-else")).toBe("emoji");
  });

  test("nerd recognized", () => {
    expect(parseGlyphMode("nerd")).toBe("nerd");
  });

  test("plain recognized", () => {
    expect(parseGlyphMode("plain")).toBe("plain");
  });
});

describe("glyphsFor", () => {
  test("emoji set has the original visual identity", () => {
    const g = glyphsFor("emoji");
    expect(g.separator).toBe("│");
    expect(g.context).toBe("✍️");
    expect(g.brain).toBe("🧠");
    expect(g.effortMax).toBe("◉");
  });

  test("plain set is ASCII-only", () => {
    const g = glyphsFor("plain");
    for (const value of Object.values(g)) {
      // Each plain glyph must be representable in 7-bit ASCII.
      for (const ch of value) {
        expect(ch.charCodeAt(0)).toBeLessThanOrEqual(127);
      }
    }
  });

  test("nerd set keeps emojis where they shine, swaps clock and bars", () => {
    const g = glyphsFor("nerd");
    expect(g.context).toBe("✍️");
    expect(g.brain).toBe("🧠");
    expect(g.cost).toBe("💸");
    // Bar cells switch to NerdFont private-use codepoints.
    expect(g.barFilled).not.toBe("●");
    expect(g.barEmpty).not.toBe("○");
  });

  test("nerd set has no silently-empty slots", () => {
    // Regression guard: NerdFont private-use codepoints (e.g. ) are
    // invisible in editors that don't render them, and a refactor that
    // round-trips through such an editor can collapse them to "". An empty
    // slot in NERD makes the progress bar render as a blank string and
    // every separator/icon vanish — silently broken for nerd-mode users.
    for (const [name, value] of Object.entries(glyphsFor("nerd"))) {
      expect(value, `nerd glyph ${name} must not be empty`).not.toBe("");
    }
  });

  test("all three sets cover the same slots", () => {
    const slots = Object.keys(glyphsFor("emoji"));
    expect(Object.keys(glyphsFor("nerd")).sort()).toEqual(slots.sort());
    expect(Object.keys(glyphsFor("plain")).sort()).toEqual(slots.sort());
  });
});
