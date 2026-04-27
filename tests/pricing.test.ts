import { describe, expect, test } from "bun:test";
import { pricingFor } from "../src/pricing.js";

describe("pricingFor", () => {
  test("matches Opus 4.x ids and aliases", () => {
    expect(pricingFor("claude-opus-4-7-20260101")?.input).toBe(15);
    expect(pricingFor("opus-4-7")?.output).toBe(75);
    expect(pricingFor("opus[1m]")?.input).toBe(15);
  });

  test("matches Sonnet 4.x", () => {
    expect(pricingFor("claude-sonnet-4-6")?.input).toBe(3);
    expect(pricingFor("sonnet-4")?.output).toBe(15);
  });

  test("matches Haiku 4.x", () => {
    expect(pricingFor("claude-haiku-4-5-20251001")?.input).toBe(1);
  });

  test("matches Haiku 3.5", () => {
    expect(pricingFor("claude-haiku-3-5")?.input).toBe(0.8);
  });

  test("returns undefined for unknown model", () => {
    expect(pricingFor("gpt-4")).toBeUndefined();
    expect(pricingFor("")).toBeUndefined();
    expect(pricingFor(undefined)).toBeUndefined();
    expect(pricingFor(null)).toBeUndefined();
  });

  test("case insensitive match", () => {
    expect(pricingFor("CLAUDE-OPUS-4-7")?.input).toBe(15);
  });

  test("matches display-name strings (used when model.id missing)", () => {
    expect(pricingFor("Opus 4.7")?.input).toBe(15);
    expect(pricingFor("Sonnet 4.6")?.input).toBe(3);
    expect(pricingFor("Haiku 3.5")?.input).toBe(0.8);
  });

  test("matches display-name with punctuation and whitespace", () => {
    expect(pricingFor("Claude Opus 4.7 (1M context)")?.input).toBe(15);
  });
});
