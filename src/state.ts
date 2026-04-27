import { loadJson, saveJson } from "./safeJsonFile.js";

export interface RateSample {
  pct: number;
  epoch: number; // seconds since epoch
}

export interface LatencySample {
  ms: number;
  epoch: number; // seconds since epoch
}

// Latency window: keep up to ~60 minutes of history with a hard cap so
// the on-disk state file stays small. The cache TTL is 60s, so in
// realistic usage we won't append more than once a minute, but the cap
// defends against pathological cases where the clock jitters.
export const LATENCY_WINDOW_SEC = 60 * 60;
export const LATENCY_MAX_SAMPLES = 240;

// Only the 5-hour window has a useful burn-rate projection — the 7-day
// window resets weekly and a render-to-render delta is too noisy to
// project. If we ever decide the 7-day projection is worth showing,
// extend this shape and `projectAndPersistFiveHour` together.
export interface RateState {
  fiveHour?: RateSample;
  latencySamples?: LatencySample[];
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

function isValidLatencySample(v: unknown): v is LatencySample {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s["ms"] === "number" &&
    Number.isFinite(s["ms"]) &&
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
  const rawSamples = obj["latencySamples"];
  if (Array.isArray(rawSamples)) {
    const valid = rawSamples.filter(isValidLatencySample);
    if (valid.length > 0) out.latencySamples = valid;
  }
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

export interface AppendLatencyOptions {
  windowSec?: number;
  maxSamples?: number;
}

// Pure function: returns a new RateState with `sample` appended and old
// samples pruned. We prune by `nowEpoch - windowSec` (default 60 min),
// then cap to `maxSamples` (newest wins) so a misbehaving clock cannot
// blow up the on-disk state.
export function appendLatencySample(
  state: RateState,
  sample: LatencySample,
  options: AppendLatencyOptions = {},
): RateState {
  // Reject garbage at the persistence boundary. A negative or non-finite
  // sample would otherwise poison the percentile window for up to 60
  // minutes — Date.now() is not strictly monotonic, so a clock jump
  // mid-fetch can produce a negative latency.
  if (
    !Number.isFinite(sample.ms) ||
    sample.ms < 0 ||
    !Number.isFinite(sample.epoch)
  ) {
    return state;
  }
  const windowSec = options.windowSec ?? LATENCY_WINDOW_SEC;
  const maxSamples = options.maxSamples ?? LATENCY_MAX_SAMPLES;
  const cutoff = sample.epoch - windowSec;
  const prior = state.latencySamples ?? [];
  const kept = [...prior.filter((s) => s.epoch >= cutoff), sample];
  return {
    ...state,
    latencySamples: kept.length > maxSamples ? kept.slice(-maxSamples) : kept,
  };
}

// Pure function: returns p50/p99 of the supplied samples or `undefined`
// when there is too little history to be meaningful. We require at
// least 5 samples — below that, percentiles are noise.
const LATENCY_MIN_SAMPLES_FOR_PERCENTILES = 5;

export function latencyPercentiles(
  samples: LatencySample[] | undefined,
): { p50: number; p99: number } | undefined {
  if (!samples || samples.length < LATENCY_MIN_SAMPLES_FOR_PERCENTILES) {
    return undefined;
  }
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p99: percentile(sorted, 0.99),
  };
}

// Nearest-rank percentile. We use ceil so the p99 of a small window is
// the actual worst sample (not interpolated), which matches user
// intuition for "tail latency".
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  const idx = Math.min(sorted.length - 1, rank - 1);
  return sorted[idx] ?? 0;
}
