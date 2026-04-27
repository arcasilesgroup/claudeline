import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitInfo, isWorktreeGitDir, parseGitStatus } from "../src/git.js";

const isolatedEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function initRepo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "claudeline-git-"));
  spawnSync("git", ["init", "-b", "main", "-q"], { cwd: tmp, env: isolatedEnv });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: tmp });
  spawnSync("git", ["config", "user.name", "t"], { cwd: tmp });
  return tmp;
}

describe("parseGitStatus", () => {
  test("untracked branch (no remote)", () => {
    expect(parseGitStatus("## main\n")).toEqual({ branch: "main", dirty: false });
  });

  test("tracked branch with origin", () => {
    expect(parseGitStatus("## main...origin/main\n")).toEqual({
      branch: "main",
      dirty: false,
    });
  });

  test("tracked branch ahead/behind", () => {
    expect(parseGitStatus("## main...origin/main [ahead 1]\n")).toEqual({
      branch: "main",
      dirty: false,
    });
  });

  test("detached HEAD returns branch=undefined", () => {
    expect(parseGitStatus("## HEAD (no branch)\n")).toEqual({
      branch: undefined,
      dirty: false,
    });
  });

  test("dirty when porcelain entries follow header", () => {
    expect(parseGitStatus("## main\n M a.txt\n?? b.txt\n")).toEqual({
      branch: "main",
      dirty: true,
    });
  });

  test("branch with slash characters preserved", () => {
    expect(parseGitStatus("## feature/foo\n")).toEqual({
      branch: "feature/foo",
      dirty: false,
    });
  });

  test("fresh repo with no commits yet", () => {
    expect(parseGitStatus("## No commits yet on main\n")).toEqual({
      branch: "main",
      dirty: false,
    });
  });

  test("fresh repo with no commits and dirty entries", () => {
    expect(parseGitStatus("## No commits yet on main\n?? a.txt\n")).toEqual({
      branch: "main",
      dirty: true,
    });
  });
});

describe("isWorktreeGitDir", () => {
  test("main worktree gitdir is .git or absolute /.git", () => {
    expect(isWorktreeGitDir(".git")).toBe(false);
    expect(isWorktreeGitDir("/Users/x/repo/.git")).toBe(false);
  });

  test("linked worktree contains .git/worktrees/<name>", () => {
    expect(isWorktreeGitDir("/Users/x/repo/.git/worktrees/feature")).toBe(true);
    expect(isWorktreeGitDir(".git/worktrees/foo")).toBe(true);
  });

  test("Windows separators recognized", () => {
    expect(
      isWorktreeGitDir("C:\\Users\\x\\repo\\.git\\worktrees\\feature"),
    ).toBe(true);
  });
});

describe("getGitInfo", () => {
  test("returns no branch outside a git repo", () => {
    const tmp = mkdtempSync(join(tmpdir(), "claudeline-nogit-"));
    try {
      const info = getGitInfo(tmp);
      expect(info.branch).toBeUndefined();
      expect(info.dirty).toBe(false);
      expect(info.worktree).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns dirty=true when working tree has changes", () => {
    const tmp = initRepo();
    try {
      writeFileSync(join(tmp, "a.txt"), "hello");
      const info = getGitInfo(tmp);
      expect(info.branch).toBe("main");
      expect(info.dirty).toBe(true);
      expect(info.worktree).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns branch and dirty=false on clean repo", () => {
    const tmp = initRepo();
    try {
      writeFileSync(join(tmp, "a.txt"), "hello");
      spawnSync("git", ["add", "."], { cwd: tmp });
      spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
      const info = getGitInfo(tmp);
      expect(info.branch).toBe("main");
      expect(info.dirty).toBe(false);
      expect(info.worktree).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("detached HEAD via direct checkout returns branch=undefined", () => {
    const tmp = initRepo();
    try {
      writeFileSync(join(tmp, "a.txt"), "hello");
      spawnSync("git", ["add", "."], { cwd: tmp });
      spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
      spawnSync("git", ["checkout", "-q", "--detach", "HEAD"], { cwd: tmp });
      const info = getGitInfo(tmp);
      expect(info.branch).toBeUndefined();
      expect(info.dirty).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("detects linked worktree", () => {
    const tmp = initRepo();
    const wtRoot = `${tmp}-wt`;
    try {
      writeFileSync(join(tmp, "a.txt"), "hello");
      spawnSync("git", ["add", "."], { cwd: tmp });
      spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
      spawnSync(
        "git",
        ["worktree", "add", "-b", "feat/x", wtRoot],
        { cwd: tmp, env: isolatedEnv },
      );
      const info = getGitInfo(wtRoot);
      expect(info.branch).toBe("feat/x");
      expect(info.worktree).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(wtRoot, { recursive: true, force: true });
    }
  });
});
