import { RESET, style } from "./ansi.js";
import type { GitInfo } from "./git.js";
import type { Settings, StatuslineInput, UsageApiResponse } from "./schemas.js";
import {
  contextSegment,
  directorySegment,
  effortSegment,
  modelSegment,
  sessionSegment,
  thinkingSegment,
} from "./segments.js";
import { parseIsoToEpoch } from "./time.js";
import {
  type ExtraUsage,
  type RateLimitsData,
  type RateLimitWindow,
  extractRateLimitsFromInput,
  renderRateLines,
} from "./usage.js";
import { formatEpoch } from "./time.js";

export interface RenderDeps {
  readSettings(): Settings;
  getGitInfo(cwd: string): GitInfo;
  detect24Hour: boolean;
  timeZone?: string;
  now(): number;
  skipPermissions: boolean;
  loadToken(): string | undefined;
  fetchUsage(token: string): Promise<UsageApiResponse | undefined>;
  cacheLoad(): UsageApiResponse | undefined;
  cacheSave(data: UsageApiResponse): void;
}

const SEPARATOR = ` ${style.dim}│${RESET} `;
const BAR_WIDTH = 10;

export async function renderStatusline(
  input: StatuslineInput,
  deps: RenderDeps,
): Promise<string> {
  const settings = deps.readSettings();
  const cwd = pickCwd(input);
  const gitInfo = cwd ? deps.getGitInfo(cwd) : { branch: undefined, dirty: false };
  const sessionElapsed = computeSessionElapsed(input, deps.now);
  const effortLevel = input.effort?.level ?? settings.effortLevel ?? undefined;
  const thinkingEnabled =
    input.thinking?.enabled ?? settings.alwaysThinkingEnabled ?? false;

  const line1Parts: string[] = [
    modelSegment(input.model?.display_name),
    contextSegment(buildContextInput(input)),
    directorySegment({
      cwd: cwd ?? "",
      ...(gitInfo.branch ? { gitBranch: gitInfo.branch } : {}),
      gitDirty: gitInfo.dirty,
      skipPermissions: deps.skipPermissions,
    }),
  ];

  const sessionStr = sessionSegment(sessionElapsed);
  if (sessionStr) line1Parts.push(sessionStr);

  const effortStr = effortSegment(effortLevel);
  const thinkingStr = thinkingSegment(thinkingEnabled);
  if (effortStr || thinkingStr) {
    line1Parts.push(
      [effortStr, thinkingStr].filter((s) => s !== "").join(" "),
    );
  }

  const line1 = line1Parts.join(SEPARATOR);

  const rateData = await gatherRateLimits(input, deps);
  const lines2plus = renderRateLines(rateData, {
    use24h: deps.detect24Hour,
    ...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
    barWidth: BAR_WIDTH,
  });

  if (!lines2plus) return line1;
  return `${line1}\n\n${lines2plus}`;
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
    windowSize: cw?.context_window_size ?? 200_000,
    inputTokens: usage?.input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
  if (typeof cw?.used_percentage === "number") {
    result.usedPercentage = cw.used_percentage;
  }
  return result;
}

async function gatherRateLimits(
  input: StatuslineInput,
  deps: RenderDeps,
): Promise<RateLimitsData> {
  const fromStdin = extractRateLimitsFromInput(input);
  if (fromStdin) {
    return {
      fiveHour: fromStdin.fiveHour,
      sevenDay: fromStdin.sevenDay,
      extra: undefined,
    };
  }

  let usage = deps.cacheLoad();
  if (!usage) {
    const token = deps.loadToken();
    if (token) {
      usage = await deps.fetchUsage(token);
      if (usage) deps.cacheSave(usage);
    }
  }
  if (!usage) {
    return { fiveHour: undefined, sevenDay: undefined, extra: undefined };
  }
  return adaptApiUsage(usage, deps);
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
