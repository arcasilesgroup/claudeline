import { loadJson, saveJson } from "./safeJsonFile.js";

export interface RateSample {
  pct: number;
  epoch: number; // seconds since epoch
}

// Only the 5-hour window has a useful burn-rate projection — the 7-day
// window resets weekly and a render-to-render delta is too noisy to
// project. If we ever decide the 7-day projection is worth showing,
// extend this shape and `projectAndPersistFiveHour` together.
export interface RateState {
  fiveHour?: RateSample;
}

function isValidSample(v: unknown): v is RateSample {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s["pct"] === "number" &&
    Number.isFinite(s["pct"]) &&
    typeof s["epoch"] === "number" &&
    Number.isFinite(s["epoch"])
  );
}

export function loadState(filePath: string): RateState {
  const raw = loadJson<unknown>(filePath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: RateState = {};
  if (isValidSample(obj["fiveHour"])) out.fiveHour = obj["fiveHour"];
  return out;
}

export function saveState(filePath: string, state: RateState): void {
  saveJson(filePath, state, { tmpPrefix: ".state" });
}

// Derive minutes-until-100% at the burn rate observed between `previous`
// and `current`. Returns undefined when:
// - There is no previous sample yet,
// - The interval is too short or too long (we don't trust very stale data),
// - Burn rate is zero/negative (usage flat or going down).
//
// The clamps keep the projection from displaying a wildly misleading
// number when the user just opened a fresh session.
const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 30 * 60;

export function projectMinutes(
  previous: RateSample | undefined,
  current: RateSample,
): number | undefined {
  if (!previous) return undefined;
  const dtSec = current.epoch - previous.epoch;
  if (dtSec < MIN_INTERVAL_SEC) return undefined;
  if (dtSec > MAX_INTERVAL_SEC) return undefined;
  const dPct = current.pct - previous.pct;
  if (dPct <= 0) return undefined;
  const ratePerMinute = (dPct / dtSec) * 60;
  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) return undefined;
  const remaining = Math.max(0, 100 - current.pct);
  if (remaining === 0) return 0;
  const minutes = Math.round(remaining / ratePerMinute);
  // Cap at a sane upper bound — the bar will hit reset before then.
  if (minutes > 24 * 60) return undefined;
  return minutes;
}
