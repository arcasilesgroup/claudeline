import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function loadJsonCache<T = unknown>(
  filePath: string,
  maxAgeMs: number,
): T | undefined {
  try {
    const stat = statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > maxAgeMs) return undefined;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function saveJsonCache(filePath: string, data: unknown): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    writeFileSync(filePath, JSON.stringify(data), { mode: 0o600 });
  } catch {
    // best-effort cache; ignore failures
  }
}
