import type { FetchUsageResult } from "./api.js";
import { RESET, style } from "./ansi.js";
import type { GitInfo } from "./git.js";
import type { GlyphSet } from "./glyphs.js";
import { resolvePrice } from "./pricingSource.js";
import type { Settings, StatuslineInput, UsageApiResponse } from "./schemas.js";
import {
  type LatencySummary,
  computeCost,
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

export interface CachedUsageWithAge {
  cache: CachedUsage;
  ageMs: number;
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
  // Returns the cached usage along with its age in ms, or undefined when
  // the cache is missing or older than the TTL the cli wired in. The
  // render path decides whether to also kick off a background refresh
  // based on how stale the data is.
  cacheLoad(): CachedUsageWithAge | undefined;
  cacheSave(data: CachedUsage): void;
  loadState(): RateState;
  saveState(state: RateState): void;
  // Optional: spawn a detached process that re-fetches and updates the
  // cache without blocking this render. Used for stale-while-revalidate
  // when the cache is usable but old. Tests omit this so the SWR path
  // stays inert in renderStatusline-only unit tests.
  refreshInBackground?(): void;
  // When true, ignore `input.rate_limits` from stdin and always read
  // from the OAuth-API cache (or fetch). Default false preserves the
  // stdin-first priority that's correct for the common case (recent
  // Claude Code versions pass fresh rate_limits in stdin). Setting via
  // CLAUDELINE_PREFER_API=1 makes `claudeline refresh` actually drive
  // what's shown, at the cost of one extra OAuth API call when the
  // cache expires.
  preferApi?: boolean;
}

// SWR threshold: cached data older than this triggers a background
// refresh on the next render (still served immediately). Below this the
// cache is "fresh enough" and we skip the spawn cost. 5 s matches the
// "1-2 prompts per minute" interactive cadence — long enough to dedup
// rapid renders, short enough that the next prompt sees fresh-ish data.
const SWR_REVALIDATE_AFTER_MS = 5_000;

const BAR_WIDTH = 10;
// Fallback when stdin omits context_window_size — matches the legacy
// non-1M Claude default. If the input has zero tokens, the segment
// renders 0% regardless, so an off-by-default isn't catastrophic.
const DEFAULT_CONTEXT_WINDOW = 200_000;

// Structured view of the same data that renderStatusline turns into an
// ANSI line. Exposed via `claudeline render --json` so editors and other
// consumers can render their own UI without parsing ANSI.
//
// Schema is part of the public surface. Adding fields is non-breaking;
// removing or renaming requires a major version bump.
export interface StatuslineData {
  version: string;
  generated_at: string;
  model: { id: string | null; display_name: string | null };
  context: {
    used_percentage: number | null;
    window_size: number;
    tokens: {
      input: number;
      cache_creation: number;
      cache_read: number;
      output: number;
    };
  };
  cost: {
    total_usd: number | null;
    // "server" when Claude Code provided cost.total_cost_usd directly;
    // "estimated" when we computed it from token counts × pricing.
    // null when neither path produced a value.
    source: "server" | "estimated" | null;
  };
  session: {
    id: string | null;
    started_at: string | null;
    elapsed_seconds: number | null;
  };
  effort: { level: string | null };
  thinking: { enabled: boolean };
  flags: {
    fast_mode: boolean;
    exceeds_200k_tokens: boolean;
    skip_permissions: boolean;
  };
  directory: {
    cwd: string | null;
    git: {
      branch: string | null;
      dirty: boolean;
      worktree: boolean;
    };
  };
  rate_limits: {
    five_hour: {
      pct: number;
      resets_at_epoch: number | null;
      projection_minutes: number | null;
    } | null;
    seven_day: { pct: number; resets_at_epoch: number | null } | null;
    extra: {
      enabled: boolean;
      pct: number;
      used_cents: number;
      limit_cents: number;
      reset_label: string;
    } | null;
  };
  latency: {
    last_ms: number | null;
    p50_ms: number | null;
    p99_ms: number | null;
  };
}

export async function renderStatuslineData(
  input: StatuslineInput,
  deps: RenderDeps,
  meta: { version: string },
): Promise<StatuslineData> {
  const cwd = pickCwd(input);
  const gitInfo = cwd
    ? deps.getGitInfo(cwd)
    : { branch: undefined, dirty: false, worktree: false };
  const sessionElapsed = computeSessionElapsed(input, deps.now);
  const settings = deps.readSettings();
  const effortLevel = input.effort?.level ?? settings.effortLevel ?? null;
  const thinkingEnabled =
    input.thinking?.enabled ?? settings.alwaysThinkingEnabled ?? false;

  const usage = input.context_window?.current_usage;
  const windowSize =
    input.context_window?.context_window_size ?? DEFAULT_CONTEXT_WINDOW;

  const { rateData, latencyMs, latencySummary } = await gatherRateLimits(
    input,
    deps,
  );

  // Cost source: server beats local estimation. Both render paths share
  // the single `computeCost` (cache-aware, 1M-tier-aware); the JSON path
  // just maps the {dollars, source} result and preserves toFixed(4)
  // rounding here at the boundary.
  const resolvedForJson = resolvePrice(input.model?.id);
  const costResult = computeCost(
    buildCostInput(input, resolvedForJson?.provider === "anthropic"),
    resolvedForJson?.pricing,
  );
  const costSource: StatuslineData["cost"]["source"] =
    costResult?.source ?? null;
  const costTotal: number | null = costResult
    ? Number(costResult.dollars.toFixed(4))
    : null;

  return {
    version: meta.version,
    generated_at: new Date(deps.now()).toISOString(),
    model: {
      id: input.model?.id ?? null,
      display_name: input.model?.display_name ?? null,
    },
    context: {
      used_percentage:
        typeof input.context_window?.used_percentage === "number"
          ? input.context_window.used_percentage
          : null,
      window_size: windowSize,
      tokens: {
        input: usage?.input_tokens ?? 0,
        cache_creation: usage?.cache_creation_input_tokens ?? 0,
        cache_read: usage?.cache_read_input_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
      },
    },
    cost: { total_usd: costTotal, source: costSource },
    session: {
      id: input.session?.id ?? null,
      started_at: input.session?.start_time ?? null,
      elapsed_seconds: sessionElapsed ?? null,
    },
    effort: { level: effortLevel ?? null },
    thinking: { enabled: thinkingEnabled === true },
    flags: {
      fast_mode: input.fast_mode === true,
      exceeds_200k_tokens: input.exceeds_200k_tokens === true,
      skip_permissions: deps.skipPermissions === true,
    },
    directory: {
      cwd: cwd ?? null,
      git: {
        branch: gitInfo.branch ?? null,
        dirty: gitInfo.dirty,
        worktree: gitInfo.worktree,
      },
    },
    rate_limits: {
      five_hour: rateData.fiveHour
        ? {
            pct: rateData.fiveHour.pct,
            resets_at_epoch: rateData.fiveHour.resetEpoch ?? null,
            projection_minutes:
              typeof rateData.fiveHour.projectionMinutes === "number"
                ? rateData.fiveHour.projectionMinutes
                : null,
          }
        : null,
      seven_day: rateData.sevenDay
        ? {
            pct: rateData.sevenDay.pct,
            resets_at_epoch: rateData.sevenDay.resetEpoch ?? null,
          }
        : null,
      extra: rateData.extra
        ? {
            enabled: rateData.extra.enabled,
            pct: rateData.extra.pct,
            used_cents: rateData.extra.usedCents,
            limit_cents: rateData.extra.limitCents,
            reset_label: rateData.extra.resetLabel,
          }
        : null,
    },
    latency: {
      last_ms: latencyMs ?? null,
      p50_ms: latencySummary?.p50 ?? null,
      p99_ms: latencySummary?.p99 ?? null,
    },
  };
}

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

  const resolvedForCost = resolvePrice(input.model?.id);
  const cost = costSegment(
    buildCostInput(input, resolvedForCost?.provider === "anthropic"),
    resolvedForCost?.pricing,
    glyphs,
  );
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
  const lines: string[] = [
    latencyStr ? `${line1}${separator}${latencyStr}` : line1,
  ];

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

function buildCostInput(
  input: StatuslineInput,
  isAnthropic?: boolean | undefined,
) {
  const usage = input.context_window?.current_usage;
  return {
    totalCostUsd: input.cost?.total_cost_usd ?? undefined,
    modelId: input.model?.id ?? input.model?.display_name ?? undefined,
    inputTokens: usage?.input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    // Distinguish "usage present" from "zero tokens" so the server cost is
    // used strictly as a null-usage fallback (spec-001 Decision 3).
    hasUsage: usage != null,
    isAnthropic,
    contextWindowSize: input.context_window?.context_window_size ?? undefined,
    exceeds200k: input.exceeds_200k_tokens === true,
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
  // CLAUDELINE_PREFER_API=1 (or programmatic deps.preferApi=true) skips
  // this stdin-first path, forcing the renderer to read from the
  // OAuth-API cache. The trade-off is documented under "Freshness" in
  // the README — most users want stdin priority because it's what the
  // active session itself sees, but power users who hit `claudeline
  // refresh` and expect numbers to update need API priority.
  const fromStdin = deps.preferApi ? null : extractRateLimitsFromInput(input);
  if (fromStdin) {
    const cachedInfo = deps.cacheLoad();
    const extra = cachedInfo
      ? adaptExtra(cachedInfo.cache.data.extra_usage, deps)
      : undefined;
    const data: RateLimitsData = {
      fiveHour: projectAndPersistFiveHour(fromStdin.fiveHour, deps),
      sevenDay: fromStdin.sevenDay ?? undefined,
      extra,
    };
    return { rateData: data, latencyMs: undefined, latencySummary: undefined };
  }

  // Latency surfaces only on the render that *fetches* — once it's in
  // cache, subsequent renders shouldn't keep showing a stale "API is
  // slow" badge. The badge means "we just timed a slow call", not "the
  // API was slow at some point in the last TTL window".
  let cachedInfo = deps.cacheLoad();
  let cached: CachedUsage | undefined = cachedInfo?.cache;
  let latencyMs: number | undefined;

  if (!cached) {
    // Cache missing or expired beyond the TTL the cli wired. Fetch
    // synchronously so the user sees data on this render.
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
  } else if (cachedInfo && cachedInfo.ageMs > SWR_REVALIDATE_AFTER_MS) {
    // Stale-while-revalidate: serve the cached data immediately, kick
    // off a detached refresh in the background so the *next* render
    // sees fresher numbers. Skipping this when there is no
    // `refreshInBackground` (tests, or older callers) keeps render
    // pure-data, no side effects.
    deps.refreshInBackground?.();
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
  const latencySummary =
    latencyMs === undefined
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
    | {
        utilization?: number | null | undefined;
        resets_at?: string | null | undefined;
      }
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
