import { loadJson, saveJson } from "./safeJsonFile.js";

export function loadJsonCache<T = unknown>(
  filePath: string,
  maxAgeMs: number,
): T | undefined {
  return loadJson<T>(filePath, { maxAgeMs });
}

export function saveJsonCache(filePath: string, data: unknown): void {
  saveJson(filePath, data, { tmpPrefix: ".cache" });
}
