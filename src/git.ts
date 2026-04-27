import { spawnSync } from "node:child_process";

export interface GitInfo {
  branch: string | undefined;
  dirty: boolean;
  worktree: boolean;
}

export function getGitInfo(cwd: string): GitInfo {
  try {
    const result = spawnSync(
      "git",
      [
        "--no-optional-locks",
        // Pack the work into a single child: --branch gives the head line,
        // --porcelain gives the dirty entries. The git-dir is read via
        // rev-parse below; sharing one process for both is not supported
        // by git, so we accept a second spawn only when in a repo.
        "status",
        "--porcelain",
        "--branch",
      ],
      { cwd, encoding: "utf-8" },
    );
    if (result.status !== 0) {
      return { branch: undefined, dirty: false, worktree: false };
    }
    const parsed = parseGitStatus(result.stdout ?? "");

    // We're in a repo (status returned 0). Detect worktree status with a
    // second cheap call; `--git-dir` of a worktree contains
    // ".git/worktrees/<name>" or sits outside the project under a
    // worktree path. This is only ~3-5ms and only fires inside repos.
    let worktree = false;
    try {
      const r2 = spawnSync(
        "git",
        ["--no-optional-locks", "rev-parse", "--git-dir"],
        { cwd, encoding: "utf-8" },
      );
      if (r2.status === 0) {
        worktree = isWorktreeGitDir((r2.stdout ?? "").trim());
      }
    } catch {
      // ignore; worktree stays false
    }

    return { ...parsed, worktree };
  } catch {
    return { branch: undefined, dirty: false, worktree: false };
  }
}

export function isWorktreeGitDir(gitDir: string): boolean {
  // Linked worktrees: `.git/worktrees/<name>` or absolute path containing
  // `/.git/worktrees/`. Main worktree: just `.git` or absolute `.../.git`.
  return /(^|[\\/])\.git[\\/]worktrees[\\/]/.test(gitDir);
}

export function parseGitStatus(stdout: string): { branch: string | undefined; dirty: boolean } {
  const lines = stdout.split("\n");
  const head = lines[0] ?? "";
  const dirty = lines.slice(1).some((l) => l.length > 0);
  let branch: string | undefined;
  if (head.startsWith("## ")) {
    const rest = head.slice(3);
    if (rest.startsWith("HEAD ") || rest === "HEAD") {
      branch = undefined;
    } else if (rest.startsWith("No commits yet on ")) {
      branch = rest.slice("No commits yet on ".length).trim() || undefined;
    } else {
      const branchPart = rest.split("...")[0]?.split(" ")[0];
      branch = branchPart || undefined;
    }
  }
  return { branch, dirty };
}
