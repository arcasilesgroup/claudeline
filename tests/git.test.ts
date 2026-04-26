import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitInfo } from "../src/git.js";

describe("getGitInfo", () => {
  test("returns no branch outside a git repo", () => {
    const tmp = mkdtempSync(join(tmpdir(), "claudeline-nogit-"));
    try {
      const info = getGitInfo(tmp);
      expect(info.branch).toBeUndefined();
      expect(info.dirty).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns dirty=true when working tree has changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "claudeline-git-"));
    try {
      spawnSync("git", ["init", "-b", "main", "-q"], { cwd: tmp });
      spawnSync("git", ["config", "user.email", "test@example.com"], {
        cwd: tmp,
      });
      spawnSync("git", ["config", "user.name", "test"], { cwd: tmp });
      writeFileSync(join(tmp, "a.txt"), "hello");
      const info = getGitInfo(tmp);
      expect(info.branch).toBe("main");
      expect(info.dirty).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
