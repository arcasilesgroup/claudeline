import { describe, expect, test } from "bun:test";
import { detect24Hour, formatEpoch, parseIsoToEpoch } from "../src/time.js";

describe("detect24Hour", () => {
  test("respects explicit macOS force24=true", () => {
    expect(detect24Hour({ force24h: true, env: {} })).toBe(true);
  });

  test("respects explicit macOS force24=false", () => {
    expect(detect24Hour({ force24h: false, env: {} })).toBe(false);
  });

  test("AppleLocale en_US → 12h", () => {
    expect(detect24Hour({ appleLocale: "en_US", env: {} })).toBe(false);
  });

  test("AppleLocale en_ES → 24h", () => {
    expect(detect24Hour({ appleLocale: "en_ES", env: {} })).toBe(true);
  });

  test("AppleLocale en_CA → 12h", () => {
    expect(detect24Hour({ appleLocale: "en_CA", env: {} })).toBe(false);
  });

  test("LANG en_US.UTF-8 → 12h", () => {
    expect(detect24Hour({ env: { LANG: "en_US.UTF-8" } })).toBe(false);
  });

  test("LANG es_ES.UTF-8 → 24h", () => {
    expect(detect24Hour({ env: { LANG: "es_ES.UTF-8" } })).toBe(true);
  });

  test("LC_TIME beats LANG", () => {
    expect(
      detect24Hour({ env: { LANG: "en_US.UTF-8", LC_TIME: "es_ES.UTF-8" } }),
    ).toBe(true);
  });

  test("force24 beats AppleLocale and LANG", () => {
    expect(
      detect24Hour({
        force24h: true,
        appleLocale: "en_US",
        env: { LANG: "en_US.UTF-8" },
      }),
    ).toBe(true);
  });

  test("default when nothing → 24h", () => {
    expect(detect24Hour({ env: {} })).toBe(true);
  });
});

describe("formatEpoch", () => {
  // 2026-04-26T16:45:00Z = 18:45 Europe/Madrid (DST +02:00)
  const fixedEpoch = 1777221900;
  const tz = "Europe/Madrid";

  test("time 24h", () => {
    expect(
      formatEpoch(fixedEpoch, { style: "time", use24h: true, timeZone: tz }),
    ).toBe("18:45");
  });

  test("time 12h is lowercase no space no period", () => {
    const out = formatEpoch(fixedEpoch, {
      style: "time",
      use24h: false,
      timeZone: tz,
    });
    expect(out).toBe("6:45pm");
  });

  test("datetime 24h day-first", () => {
    expect(
      formatEpoch(fixedEpoch, {
        style: "datetime",
        use24h: true,
        timeZone: tz,
      }),
    ).toBe("26 apr, 18:45");
  });

  test("datetime 12h month-first", () => {
    expect(
      formatEpoch(fixedEpoch, {
        style: "datetime",
        use24h: false,
        timeZone: tz,
      }),
    ).toBe("apr 26, 6:45pm");
  });

  test("date 24h day-first", () => {
    expect(
      formatEpoch(fixedEpoch, { style: "date", use24h: true, timeZone: tz }),
    ).toBe("26 apr");
  });

  test("date 12h month-first", () => {
    expect(
      formatEpoch(fixedEpoch, { style: "date", use24h: false, timeZone: tz }),
    ).toBe("apr 26");
  });

  test("returns empty string for invalid epoch", () => {
    expect(
      formatEpoch(0, { style: "time", use24h: true, timeZone: tz }),
    ).toBe("");
    expect(
      formatEpoch(Number.NaN, { style: "time", use24h: true, timeZone: tz }),
    ).toBe("");
  });
});

describe("parseIsoToEpoch", () => {
  test("parses Z UTC", () => {
    expect(parseIsoToEpoch("2026-04-26T16:45:00Z")).toBe(1777221900);
  });

  test("parses ISO with offset", () => {
    expect(parseIsoToEpoch("2026-04-26T18:45:00+02:00")).toBe(1777221900);
  });

  test("returns undefined for invalid input", () => {
    expect(parseIsoToEpoch("not-a-date")).toBeUndefined();
    expect(parseIsoToEpoch("")).toBeUndefined();
    expect(parseIsoToEpoch(undefined)).toBeUndefined();
  });

  test("passes through epoch numbers", () => {
    expect(parseIsoToEpoch(1777221900)).toBe(1777221900);
  });
});
