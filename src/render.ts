import type { FetchUsageResult } from "./api.js";
import { RESET, style } from "./ansi.js";
import type { GitInfo } from "./git.js";
import type { GlyphSet } from "./glyphs.js";
import { pricingFor } from "./pricing.js";
import type { Settings, StatuslineInput, UsageApiResponse } from "./schemas.js";
import {
  type LatencySummary,
  contextSegment,
  costSegment,
  directorySegment,
  effortSegment,
  fastModeSegment,
  largeContextSegment,
  latencySegment,
  modelSegment,
  sessionSegment,
  thinkingSegment,
} from "./segments.js";
import {
  type RateSample,
  type RateState,
  appendLatencySample,
  latencyPercentiles,
  projectMinutes,
} from "./state.js";
import { formatEpoch, parseIsoToEpoch } from "./time.js";
import {
  type ExtraUsage,
  type RateLimitsData,
  type RateLimitWindow,
  extractRateLimitsFromInput,
  renderRateLines,
} from "./usage.js";

export interface CachedUsage {
  data: UsageApiResponse;
  latencyMs: number;
}

export interface RenderDeps {
  readSettings(): Settings;
  getGitInfo(cwd: string): GitInfo;
  detect24Hour: boolean;
  timeZone?: string;
  now(): number;
  skipPermissions: boolean;
  glyphs: GlyphSet;
  loadToken(): string | undefined;
  fetchUsage(token: string): Promise<FetchUsageResult | undefined>;
  cacheLoad(): CachedUsage | undefined;
  cacheSave(data: CachedUsage): void;
  loadState(): RateState;
  saveState(state: RateState): void;
}

const BAR_WIDTH = 10;
// Fallback when stdin omits context_window_size — matches the legacy
// non-1M Claude default. If the input has zero tokens, the segment
// renders 0% regardless, so an off-by-default isn't catastrophic.
const DEFAULT_CONTEXT_WINDOW = 200_000;

export async function renderStatusline(
  input: StatuslineInput,
  deps: RenderDeps,
): Promise<string> {
  const settings = deps.readSettings();
  const cwd = pickCwd(input);
  const gitInfo = cwd
    ? deps.getGitInfo(cwd)
    : { branch: undefined, dirty: false, worktree: false };
  const sessionElapsed = computeSessionElapsed(input, deps.now);
  const effortLevel = input.effort?.level ?? settings.effortLevel ?? undefined;
  const thinkingEnabled =
    input.thinking?.enabled ?? settings.alwaysThinkingEnabled ?? false;
  const glyphs = deps.glyphs;
  const separator = ` ${style.dim}${glyphs.separator}${RESET} `;

  const line1Parts: string[] = [
    modelSegment(input.model?.display_name),
    contextSegment(buildContextInput(input), glyphs),
    directorySegment(
      {
        cwd: cwd ?? "",
        ...(gitInfo.branch ? { gitBranch: gitInfo.branch } : {}),
        gitDirty: gitInfo.dirty,
        gitWorktree: gitInfo.worktree,
        skipPermissions: deps.skipPermissions,
      },
      glyphs,
    ),
  ];

  const cost = costSegment(buildCostInput(input), pricingFor(input.model?.id), glyphs);
  if (cost) line1Parts.push(cost);

  const sessionStr = sessionSegment(sessionElapsed, glyphs);
  if (sessionStr) line1Parts.push(sessionStr);

  const effortStr = effortSegment(effortLevel, glyphs);
  const thinkingStr = thinkingSegment(thinkingEnabled, glyphs);
  const fastStr = fastModeSegment(input.fast_mode, glyphs);
  const largeStr = largeContextSegment(input.exceeds_200k_tokens, glyphs);
  const trailingBadges = joinNonEmpty(
    " ",
    effortStr,
    thinkingStr,
    fastStr,
    largeStr,
  );
  if (trailingBadges) line1Parts.push(trailingBadges);

  const line1 = line1Parts.join(separator);

  const { rateData, latencyMs, latencySummary } = await gatherRateLimits(
    input,
    deps,
  );
  const latencyStr = latencySegment(
    latencyMs,
    glyphs,
    undefined,
    latencySummary,
  );
  const lines: string[] = [latencyStr ? `${line1}${separator}${latencyStr}` : line1];

  const rateLines = renderRateLines(rateData, {
    use24h: deps.detect24Hour,
    ...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
    barWidth: BAR_WIDTH,
    glyphs,
  });
  if (rateLines) lines.push("", rateLines);

  return lines.join("\n");
}

function joinNonEmpty(sep: string, ...parts: string[]): string {
  return parts.filter((p) => p !== "").join(sep);
}

function pickCwd(input: StatuslineInput): string | undefined {
  return input.cwd ?? input.workspace?.current_dir ?? undefined;
}

function computeSessionElapsed(
  input: StatuslineInput,
  now: () => number,
): number | undefined {
  const start = parseIsoToEpoch(input.session?.start_time);
  if (!start) return undefined;
  const elapsed = Math.floor(now() / 1000) - start;
  return elapsed >= 0 ? elapsed : undefined;
}

function buildContextInput(input: StatuslineInput) {
  const cw = input.context_window;
  const usage = cw?.current_usage;
  const result: {
    windowSize: number;
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    usedPercentage?: number;
  } = {
    windowSize: cw?.context_window_size ?? DEFAULT_CONTEXT_WINDOW,
    inputTokens: usage?.input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
  if (typeof cw?.used_percentage === "number") {
    result.usedPercentage = cw.used_percentage;
  }
  return result;
}

function buildCostInput(input: StatuslineInput) {
  const usage = input.context_window?.current_usage;
  return {
    totalCostUsd: input.cost?.total_cost_usd ?? undefined,
    modelId: input.model?.id ?? input.model?.display_name ?? undefined,
    inputTokens: usage?.input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

async function gatherRateLimits(
  input: StatuslineInput,
  deps: RenderDeps,
): Promise<{
  rateData: RateLimitsData;
  latencyMs: number | undefined;
  latencySummary: LatencySummary | undefined;
}> {
  const fromStdin = extractRateLimitsFromInput(input);
  if (fromStdin) {
    const cached = deps.cacheLoad();
    const extra = cached ? adaptExtra(cached.data.extra_usage, deps) : undefined;
    const data: RateLimitsData = {
      fiveHour: projectAndPersistFiveHour(fromStdin.fiveHour, deps),
      sevenDay: fromStdin.sevenDay ?? undefined,
      extra,
    };
    return { rateData: data, latencyMs: undefined, latencySummary: undefined };
  }

  // Latency surfaces only on the render that *fetches* — once it's in
  // cache, subsequent renders shouldn't keep showing a stale "API is
  // slow" badge for up to 60s. The badge means "we just timed a slow
  // call", not "the API was slow at some point in the last minute".
  let cached = deps.cacheLoad();
  let latencyMs: number | undefined;
  if (!cached) {
    const token = deps.loadToken();
    if (token) {
      const fetched = await deps.fetchUsage(token);
      if (fetched) {
        cached = { data: fetched.data, latencyMs: fetched.latencyMs };
        deps.cacheSave(cached);
        latencyMs = fetched.latencyMs;
        recordLatencySample(latencyMs, deps);
      }
    }
  }
  if (!cached) {
    return {
      rateData: { fiveHour: undefined, sevenDay: undefined, extra: undefined },
      latencyMs: undefined,
      latencySummary: undefined,
    };
  }
  const adapted = adaptApiUsage(cached.data, deps);
  // Compute the percentile summary AFTER recording the fresh sample so
  // the badge reflects the just-observed call.
  const latencySummary = latencyMs === undefined
    ? undefined
    : latencyPercentiles(deps.loadState().latencySamples);
  return {
    rateData: {
      ...adapted,
      fiveHour: projectAndPersistFiveHour(adapted.fiveHour, deps),
    },
    latencyMs,
    latencySummary,
  };
}

// Persist the just-observed latency into state so future renders can
// compute a percentile summary. Pure compose: `appendLatencySample` is
// pure, the IO is the existing `loadState` / `saveState` round-trip.
function recordLatencySample(latencyMs: number, deps: RenderDeps): void {
  const state = deps.loadState();
  const next = appendLatencySample(state, {
    ms: latencyMs,
    epoch: Math.floor(deps.now() / 1000),
  });
  deps.saveState(next);
}

// Loads the previous 5-hour sample, computes a projection if usable,
// and persists the current sample for the NEXT render. We keep all
// three steps in one helper so callers don't accidentally double-load
// (the read-modify-write is implicitly atomic per render).
function projectAndPersistFiveHour(
  window: RateLimitWindow | undefined,
  deps: RenderDeps,
): RateLimitWindow | undefined {
  if (!window) return undefined;
  const state = deps.loadState();
  const current: RateSample = {
    pct: window.pct,
    epoch: Math.floor(deps.now() / 1000),
  };
  const projection = projectMinutes(state.fiveHour, current);

  deps.saveState({ ...state, fiveHour: current });

  if (projection === undefined) return window;
  return { ...window, projectionMinutes: projection };
}

function adaptApiUsage(
  data: UsageApiResponse,
  deps: RenderDeps,
): RateLimitsData {
  const fiveHour = adaptApiWindow(data.five_hour);
  const sevenDay = adaptApiWindow(data.seven_day);
  const extra = adaptExtra(data.extra_usage, deps);
  return { fiveHour, sevenDay, extra };
}

function adaptApiWindow(
  raw:
    | { utilization?: number | null | undefined; resets_at?: string | null | undefined }
    | null
    | undefined,
): RateLimitWindow | undefined {
  if (!raw || typeof raw.utilization !== "number") return undefined;
  return {
    pct: Math.round(raw.utilization),
    resetEpoch: parseIsoToEpoch(raw.resets_at),
  };
}

function adaptExtra(
  raw: UsageApiResponse["extra_usage"],
  deps: RenderDeps,
): ExtraUsage | undefined {
  if (!raw?.is_enabled) return undefined;
  const resetEpoch = nextMonthFirstEpoch(deps.now(), deps.timeZone);
  const resetLabel =
    formatEpoch(resetEpoch, {
      style: "date",
      use24h: deps.detect24Hour,
      ...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
    }) || "";
  return {
    enabled: true,
    pct: Math.round(raw.utilization ?? 0),
    usedCents: Math.round(raw.used_credits ?? 0),
    limitCents: Math.round(raw.monthly_limit ?? 0),
    resetLabel,
  };
}

export function nextMonthFirstEpoch(
  nowMs: number,
  timeZone: string | undefined,
): number {
  const date = new Date(nowMs);
  if (!timeZone) {
    const local = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return Math.floor(local.getTime() / 1000);
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "numeric",
  });
  const parts = fmt.formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return Math.floor(Date.UTC(nextYear, nextMonth - 1, 1) / 1000);
}
