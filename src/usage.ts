import { colorForPercentage, palette, RESET, style } from "./ansi.js";
import { buildBar } from "./progress.js";
import { formatEpoch, parseIsoToEpoch } from "./time.js";

export interface RateLimitWindow {
  pct: number;
  resetEpoch: number | undefined;
}

export interface ExtraUsage {
  enabled: boolean;
  pct: number;
  usedCents: number;
  limitCents: number;
  resetLabel: string;
}

export interface RateLimitsData {
  fiveHour: RateLimitWindow | undefined;
  sevenDay: RateLimitWindow | undefined;
  extra: ExtraUsage | undefined;
}

export function extractRateLimitsFromInput(
  input: unknown,
): { fiveHour?: RateLimitWindow; sevenDay?: RateLimitWindow } | null {
  if (!input || typeof input !== "object") return null;
  const rate = (input as Record<string, unknown>)["rate_limits"];
  if (!rate || typeof rate !== "object") return null;

  const five = pickWindow((rate as Record<string, unknown>)["five_hour"]);
  const seven = pickWindow((rate as Record<string, unknown>)["seven_day"]);
  if (!five && !seven) return null;
  return {
    ...(five ? { fiveHour: five } : {}),
    ...(seven ? { sevenDay: seven } : {}),
  };
}

function pickWindow(raw: unknown): RateLimitWindow | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const rawPct = obj["used_percentage"];
  if (typeof rawPct !== "number") return undefined;
  const resets = obj["resets_at"];
  const resetEpoch =
    typeof resets === "string" || typeof resets === "number"
      ? parseIsoToEpoch(resets)
      : undefined;
  return { pct: Math.round(rawPct), resetEpoch };
}

export interface RenderOptions {
  use24h: boolean;
  timeZone?: string;
  barWidth: number;
}

export function renderRateLines(
  data: RateLimitsData,
  options: RenderOptions,
): string {
  const lines: string[] = [];

  if (data.fiveHour) {
    lines.push(
      formatLimitLine(
        "current",
        data.fiveHour,
        { ...options, timeStyle: "time" },
      ),
    );
  }

  if (data.sevenDay) {
    lines.push(
      formatLimitLine(
        "weekly ",
        data.sevenDay,
        { ...options, timeStyle: "datetime" },
      ),
    );
  }

  if (data.extra?.enabled) {
    lines.push(formatExtraLine(data.extra, options));
  }

  return lines.join("\n");
}

function formatLimitLine(
  label: string,
  window: RateLimitWindow,
  options: RenderOptions & { timeStyle: "time" | "datetime" },
): string {
  const bar = buildBar(window.pct, options.barWidth);
  const pctColor = colorForPercentage(window.pct);
  const pctFmt = `${window.pct}`.padStart(3, " ");
  let line = `${palette.white}${label}${RESET} ${bar} ${pctColor}${pctFmt}%${RESET}`;
  if (window.resetEpoch) {
    const reset = formatEpoch(window.resetEpoch, {
      style: options.timeStyle,
      use24h: options.use24h,
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    });
    if (reset) {
      line += ` ${style.dim}⟳${RESET} ${palette.white}${reset}${RESET}`;
    }
  }
  return line;
}

function formatExtraLine(extra: ExtraUsage, options: RenderOptions): string {
  const bar = buildBar(extra.pct, options.barWidth);
  const pctColor = colorForPercentage(extra.pct);
  const used = (extra.usedCents / 100).toFixed(2);
  const limit = (extra.limitCents / 100).toFixed(2);
  return (
    `${palette.white}extra  ${RESET} ${bar} ` +
    `${pctColor}$${used}${style.dim}/${RESET}${palette.white}$${limit}${RESET} ` +
    `${style.dim}⟳${RESET} ${palette.white}${extra.resetLabel}${RESET}`
  );
}
