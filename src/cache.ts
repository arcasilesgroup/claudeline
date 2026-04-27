import type { CachedUsage } from "./render.js";
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

// Cache shape migration. Pre-0.2 stored a `UsageApiResponse` directly at
// the top level; 0.2+ wraps it as `{ data, latencyMs }`. Discard
// everything that doesn't match the new shape (including arrays-as-
// objects, null, and stale entries) — the 60 s TTL means the next
// render just re-fetches.
export function adoptCachedUsage(raw: unknown): CachedUsage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = raw as Partial<CachedUsage>;
  if (!candidate.data || typeof candidate.data !== "object") return undefined;
  if (Array.isArray(candidate.data)) return undefined;
  // latencyMs may be missing on entries from a future bump that drops it;
  // guard at read-time so latencySegment never sees NaN.
  const latencyMs =
    typeof candidate.latencyMs === "number" && Number.isFinite(candidate.latencyMs)
      ? candidate.latencyMs
      : 0;
  return { data: candidate.data, latencyMs };
}
