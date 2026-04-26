import { spawnSync } from "node:child_process";
import { platform } from "node:os";

export function readMacDefault(key: string): string | undefined {
  if (platform() !== "darwin") return undefined;
  try {
    const result = spawnSync("defaults", ["read", "-g", key], {
      encoding: "utf-8",
    });
    if (result.status !== 0) return undefined;
    const text = (result.stdout ?? "").trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

export function detectSkipPermissions(): boolean {
  if (platform() === "win32") return false;
  try {
    const ppid = process.ppid;
    if (!ppid || ppid <= 1) return false;
    const result = spawnSync("ps", ["-o", "args=", "-p", String(ppid)], {
      encoding: "utf-8",
    });
    if (result.status !== 0) return false;
    return (result.stdout ?? "").includes("--dangerously-skip-permissions");
  } catch {
    return false;
  }
}

export function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
