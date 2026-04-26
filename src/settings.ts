import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as z from "zod/mini";
import { type Settings, settingsSchema } from "./schemas.js";

export function defaultSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export function readSettingsFile(path: string = defaultSettingsPath()): Settings {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    if (!raw.trim()) return {};
    return z.parse(settingsSchema, JSON.parse(raw));
  } catch {
    return {};
  }
}
