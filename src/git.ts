import { spawnSync } from "node:child_process";

export interface GitInfo {
  branch: string | undefined;
  dirty: boolean;
}

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
    if (result.status !== 0) return undefined;
    return (result.stdout ?? "").trim();
  } catch {
    return undefined;
  }
}

export function getGitInfo(cwd: string): GitInfo {
  const inside = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") {
    return { branch: undefined, dirty: false };
  }
  const branch = runGit(cwd, ["symbolic-ref", "--short", "HEAD"]);
  const status = runGit(cwd, ["--no-optional-locks", "status", "--porcelain"]);
  return {
    branch: branch || undefined,
    dirty: !!status && status.length > 0,
  };
}
