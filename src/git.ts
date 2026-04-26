import { spawnSync } from "node:child_process";

export interface GitInfo {
  branch: string | undefined;
  dirty: boolean;
}

export function getGitInfo(cwd: string): GitInfo {
  try {
    const result = spawnSync(
      "git",
      ["--no-optional-locks", "status", "--porcelain", "--branch"],
      { cwd, encoding: "utf-8" },
    );
    if (result.status !== 0) return { branch: undefined, dirty: false };
    return parseGitStatus(result.stdout ?? "");
  } catch {
    return { branch: undefined, dirty: false };
  }
}

export function parseGitStatus(stdout: string): GitInfo {
  const lines = stdout.split("\n");
  const head = lines[0] ?? "";
  const dirty = lines.slice(1).some((l) => l.length > 0);
  let branch: string | undefined;
  if (head.startsWith("## ")) {
    const rest = head.slice(3);
    // Detached HEAD: `## HEAD (no branch)`
    if (rest.startsWith("HEAD ") || rest === "HEAD") {
      branch = undefined;
    } else if (rest.startsWith("No commits yet on ")) {
      // Fresh repo: `## No commits yet on main`
      branch = rest.slice("No commits yet on ".length).trim() || undefined;
    } else {
      // Tracked: `## main...origin/main` or `## main...origin/main [ahead 1]`
      // Untracked: `## main`
      const branchPart = rest.split("...")[0]?.split(" ")[0];
      branch = branchPart || undefined;
    }
  }
  return { branch, dirty };
}
