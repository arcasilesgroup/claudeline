import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface InstallOptions {
  settingsPath: string;
  platform: NodeJS.Platform;
}

export interface UninstallOptions {
  settingsPath: string;
}

export function statusLineCommandFor(_platform: NodeJS.Platform): string {
  return "claudeline render";
}

export function install(options: InstallOptions): void {
  const settings = readSettings(options.settingsPath);
  settings.statusLine = {
    type: "command",
    command: statusLineCommandFor(options.platform),
  };
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
