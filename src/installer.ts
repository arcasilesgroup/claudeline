import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export interface InstallOptions {
  settingsPath: string;
  platform: NodeJS.Platform;
}

export interface UninstallOptions {
  settingsPath: string;
}

// The npm-distributed package installs a `claudeline` shim on every platform
// (a shell script on Unix, a `.cmd` shim on Windows). Claude Code resolves
// the command through PATH, so the same string works everywhere. The
// `platform` argument is kept for forward compatibility — if a future
// distribution channel ships a binary that requires an absolute path, this
// is where the platform-aware switch will live.
export function statusLineCommandFor(_platform: NodeJS.Platform): string {
  return "claudeline render";
}

export function install(options: InstallOptions): void {
  const settings = readSettings(options.settingsPath);
  const command = statusLineCommandFor(options.platform);
  const existing = settings["statusLine"] as { command?: string } | undefined;
  if (existing?.command && existing.command !== command) {
    process.stderr.write(
      `claudeline: replacing existing statusLine command: ${existing.command}\n`,
    );
  }
  settings["statusLine"] = { type: "command", command };
  writeSettings(options.settingsPath, settings);
}

export function uninstall(options: UninstallOptions): void {
  if (!existsSync(options.settingsPath)) return;
  const settings = readSettings(options.settingsPath);
  delete settings["statusLine"];
  writeSettings(options.settingsPath, settings);
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (err) {
    throw new Error(`Could not parse ${path}: ${(err as Error).message}`);
  }
}

function writeSettings(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // Atomic: write to a sibling tempfile, then rename. Prevents a crash
  // mid-write from corrupting the user's settings.
  const tmp = join(dir, `.settings.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
