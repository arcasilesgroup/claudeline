import { describe, expect, test } from "bun:test";
import { resolvePrice } from "../src/pricingSource.js";

describe("resolvePrice", () => {
  test("matches Opus 4.x ids and aliases", () => {
    expect(resolvePrice("claude-opus-4-7-20260101")?.pricing?.input).toBe(15);
    expect(resolvePrice("opus-4-7")?.pricing?.output).toBe(75);
    expect(resolvePrice("opus[1m]")?.pricing?.input).toBe(15);
  });

  test("matches Sonnet 4.x", () => {
    expect(resolvePrice("claude-sonnet-4-6")?.pricing?.input).toBe(3);
    expect(resolvePrice("sonnet-4")?.pricing?.output).toBe(15);
  });

  test("matches Haiku 4.x", () => {
    expect(resolvePrice("claude-haiku-4-5-20251001")?.pricing?.input).toBe(1);
  });

  test("matches Haiku 3.5", () => {
    expect(resolvePrice("claude-haiku-3-5")?.pricing?.input).toBe(0.8);
  });

  test("returns undefined for unknown model", () => {
    expect(resolvePrice("gpt-4")).toBeUndefined();
    expect(resolvePrice("")).toBeUndefined();
    expect(resolvePrice(undefined)).toBeUndefined();
    expect(resolvePrice(null)).toBeUndefined();
  });

  test("case insensitive match", () => {
    expect(resolvePrice("CLAUDE-OPUS-4-7")?.pricing?.input).toBe(15);
  });

  test("matches display-name strings (used when model.id missing)", () => {
    expect(resolvePrice("Opus 4.7")?.pricing?.input).toBe(15);
    expect(resolvePrice("Sonnet 4.6")?.pricing?.input).toBe(3);
    expect(resolvePrice("Haiku 3.5")?.pricing?.input).toBe(0.8);
  });

  test("matches display-name with punctuation and whitespace", () => {
    expect(resolvePrice("Claude Opus 4.7 (1M context)")?.pricing?.input).toBe(
      15,
    );
  });

  test("tags provider by id prefix", () => {
    expect(resolvePrice("claude-opus-4-7")?.provider).toBe("anthropic");
    expect(resolvePrice("openrouter/anthropic/claude-opus-4-7")?.provider).toBe(
      "openrouter",
    );
    expect(resolvePrice("gpt-4o")?.provider).toBe("openrouter");
  });
});
