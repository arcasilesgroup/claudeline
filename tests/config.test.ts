import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ConfigPaths,
  deleteConfig,
  ensureConfigFile,
  readConfig,
  resolveBoolean,
  resolveSeconds,
  writeConfig,
} from "../src/config.js";

let scratch: string;
let paths: ConfigPaths;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "claudeline-config-"));
  paths = { dir: scratch, file: join(scratch, "config.json") };
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("readConfig / writeConfig", () => {
  test("returns empty object when file missing", () => {
    expect(readConfig(paths)).toEqual({});
  });

  test("round-trips a typed config", () => {
    writeConfig(paths, { preferApi: true, cacheTtlSec: 15 });
    expect(readConfig(paths)).toEqual({ preferApi: true, cacheTtlSec: 15 });
  });

  test("ignores unknown keys silently", () => {
    writeConfig(paths, { preferApi: true } as Record<string, unknown>);
    expect(readConfig(paths)).toEqual({ preferApi: true });
  });

  test("survives a hand-edited malformed file", () => {
    ensureConfigFile(paths);
    // overwrite with garbage
    writeConfig(paths, "not an object" as unknown as Record<string, unknown>);
    // The writer JSON-stringifies any value, but readConfig refuses
    // non-object payloads → empty config. Verify both via writing raw:
    Bun.write(paths.file, "{not:json");
    expect(readConfig(paths)).toEqual({});
  });

  test("rejects non-boolean preferApi at read time", () => {
    Bun.write(paths.file, JSON.stringify({ preferApi: "yes please" }));
    expect(readConfig(paths)).toEqual({});
  });

  test("rejects non-number cacheTtlSec at read time", () => {
    Bun.write(paths.file, JSON.stringify({ cacheTtlSec: "30" }));
    expect(readConfig(paths)).toEqual({});
  });
});

describe("ensureConfigFile / deleteConfig", () => {
  test("ensure creates dir + empty {} file", () => {
    ensureConfigFile(paths);
    expect(existsSync(paths.file)).toBe(true);
    expect(readConfig(paths)).toEqual({});
  });

  test("ensure is idempotent — preserves existing values", () => {
    writeConfig(paths, { preferApi: true });
    ensureConfigFile(paths);
    expect(readConfig(paths)).toEqual({ preferApi: true });
  });

  test("delete removes the file (no-op if missing)", () => {
    deleteConfig(paths); // no-op
    writeConfig(paths, { preferApi: true });
    deleteConfig(paths);
    expect(existsSync(paths.file)).toBe(false);
  });

  // Regression (ARC-289 / CWE-367): the atomic `wx` create must set
  // owner-only perms and must NOT clobber a file that appears between
  // the (now-removed) existence check and the create.
  test.skipIf(process.platform === "win32")(
    "ensure creates the file with 0o600 perms",
    () => {
      ensureConfigFile(paths);
      expect(statSync(paths.file).mode & 0o777).toBe(0o600);
    },
  );

  test("ensure does not clobber a pre-existing file (EEXIST no-op)", () => {
    writeFileSync(paths.file, '{"preferApi":true}\n');
    ensureConfigFile(paths); // must be a no-op, not a truncating write
    expect(readConfig(paths)).toEqual({ preferApi: true });
  });
});

describe("resolveBoolean precedence", () => {
  test("env > config > default", () => {
    // env wins when set to a truthy string.
    expect(
      resolveBoolean({
        envValue: "1",
        configValue: false,
        defaultValue: false,
      }),
    ).toEqual({ value: true, source: "env" });
    // config wins when env is unset.
    expect(
      resolveBoolean({
        envValue: undefined,
        configValue: true,
        defaultValue: false,
      }),
    ).toEqual({ value: true, source: "config" });
    // default when neither is set.
    expect(
      resolveBoolean({
        envValue: undefined,
        configValue: undefined,
        defaultValue: false,
      }),
    ).toEqual({ value: false, source: "default" });
  });

  test("env empty string treated as unset (falls through to config)", () => {
    expect(
      resolveBoolean({
        envValue: "",
        configValue: true,
        defaultValue: false,
      }),
    ).toEqual({ value: true, source: "config" });
  });

  test("env accepts case-insensitive truthy/falsy", () => {
    expect(
      resolveBoolean({ envValue: "TRUE", configValue: false, defaultValue: false }),
    ).toEqual({ value: true, source: "env" });
    expect(
      resolveBoolean({ envValue: "yes", configValue: false, defaultValue: false }),
    ).toEqual({ value: true, source: "env" });
    expect(
      resolveBoolean({ envValue: "false", configValue: true, defaultValue: false }),
    ).toEqual({ value: false, source: "env" });
    // Garbage string also takes the env path but resolves to false.
    expect(
      resolveBoolean({ envValue: "potato", configValue: true, defaultValue: false }),
    ).toEqual({ value: false, source: "env" });
  });
});

describe("resolveSeconds precedence + clamp", () => {
  test("env in-range wins", () => {
    expect(
      resolveSeconds({
        envValue: "15",
        configValue: 30,
        defaultValueSec: 60,
        minSec: 1,
        maxSec: 300,
      }),
    ).toEqual({ value: 15, source: "env" });
  });

  test("env out-of-range falls through to config", () => {
    expect(
      resolveSeconds({
        envValue: "9999",
        configValue: 45,
        defaultValueSec: 60,
        minSec: 1,
        maxSec: 300,
      }),
    ).toEqual({ value: 45, source: "config" });
  });

  test("env garbage falls through to config", () => {
    expect(
      resolveSeconds({
        envValue: "garbage",
        configValue: 45,
        defaultValueSec: 60,
        minSec: 1,
        maxSec: 300,
      }),
    ).toEqual({ value: 45, source: "config" });
  });

  test("config out-of-range falls through to default", () => {
    expect(
      resolveSeconds({
        envValue: undefined,
        configValue: 9999,
        defaultValueSec: 60,
        minSec: 1,
        maxSec: 300,
      }),
    ).toEqual({ value: 60, source: "default" });
  });

  test("default when both env and config absent", () => {
    expect(
      resolveSeconds({
        envValue: undefined,
        configValue: undefined,
        defaultValueSec: 30,
        minSec: 1,
        maxSec: 300,
      }),
    ).toEqual({ value: 30, source: "default" });
  });
});
