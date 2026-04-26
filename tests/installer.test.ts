import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  install,
  statusLineCommandFor,
  uninstall,
} from "../src/installer.js";

function tmpSettings() {
  const dir = mkdtempSync(join(tmpdir(), "claudeline-install-"));
  return { dir, file: join(dir, "settings.json") };
}

describe("statusLineCommandFor", () => {
  test("uses claudeline render on darwin/linux", () => {
    expect(statusLineCommandFor("darwin")).toBe("claudeline render");
    expect(statusLineCommandFor("linux")).toBe("claudeline render");
  });

  test("uses claudeline render on win32 too (npm wrapper)", () => {
    expect(statusLineCommandFor("win32")).toBe("claudeline render");
  });
});

describe("install", () => {
  test("creates settings.json with statusLine when none exists", () => {
    const { dir, file } = tmpSettings();
    try {
      install({ settingsPath: file, platform: "darwin" });
      const written = JSON.parse(readFileSync(file, "utf-8"));
      expect(written.statusLine).toEqual({
        type: "command",
        command: "claudeline render",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves existing keys when adding statusLine", () => {
    const { dir, file } = tmpSettings();
    writeFileSync(file, JSON.stringify({ model: "opus", language: "es" }));
    try {
      install({ settingsPath: file, platform: "linux" });
      const written = JSON.parse(readFileSync(file, "utf-8"));
      expect(written.model).toBe("opus");
      expect(written.language).toBe("es");
      expect(written.statusLine.command).toBe("claudeline render");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is idempotent", () => {
    const { dir, file } = tmpSettings();
    try {
      install({ settingsPath: file, platform: "darwin" });
      install({ settingsPath: file, platform: "darwin" });
      const written = JSON.parse(readFileSync(file, "utf-8"));
      expect(written.statusLine.command).toBe("claudeline render");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed settings.json with informative error", () => {
    const { dir, file } = tmpSettings();
    writeFileSync(file, "not-json");
    try {
      expect(() => install({ settingsPath: file, platform: "darwin" })).toThrow(
        /could not parse/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("uninstall", () => {
  test("removes only the statusLine key", () => {
    const { dir, file } = tmpSettings();
    writeFileSync(
      file,
      JSON.stringify({
        model: "opus",
        statusLine: { type: "command", command: "claudeline render" },
      }),
    );
    try {
      uninstall({ settingsPath: file });
      const written = JSON.parse(readFileSync(file, "utf-8"));
      expect(written.statusLine).toBeUndefined();
      expect(written.model).toBe("opus");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is a no-op when settings.json missing", () => {
    const { dir, file } = tmpSettings();
    try {
      expect(() => uninstall({ settingsPath: file })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
