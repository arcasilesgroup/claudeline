import { colorForPercentage, palette, RESET, style } from "./ansi.js";
import { buildBar } from "./progress.js";
import type { StatuslineInput } from "./schemas.js";
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

const LABEL_WIDTH = 7;
const padLabel = (s: string) => s.padEnd(LABEL_WIDTH, " ");

export function extractRateLimitsFromInput(
  input: StatuslineInput,
): { fiveHour?: RateLimitWindow; sevenDay?: RateLimitWindow } | null {
  const rate = input.rate_limits;
  if (!rate) return null;
  const five = pickWindow(rate.five_hour);
  const seven = pickWindow(rate.seven_day);
  if (!five && !seven) return null;
  return {
    ...(five ? { fiveHour: five } : {}),
    ...(seven ? { sevenDay: seven } : {}),
  };
}

type RawRateLimitWindow = NonNullable<
  NonNullable<StatuslineInput["rate_limits"]>["five_hour"]
>;

function pickWindow(raw: RawRateLimitWindow | null | undefined): RateLimitWindow | undefined {
  if (!raw || typeof raw.used_percentage !== "number") return undefined;
  return {
    pct: Math.round(raw.used_percentage),
    resetEpoch: parseIsoToEpoch(raw.resets_at),
  };
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
      formatLimitLine(padLabel("current"), data.fiveHour, {
        ...options,
        timeStyle: "time",
      }),
    );
  }

  if (data.sevenDay) {
    lines.push(
      formatLimitLine(padLabel("weekly"), data.sevenDay, {
        ...options,
        timeStyle: "datetime",
      }),
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
    `${palette.white}${padLabel("extra")}${RESET} ${bar} ` +
    `${pctColor}$${used}${style.dim}/${RESET}${palette.white}$${limit}${RESET} ` +
    `${style.dim}⟳${RESET} ${palette.white}${extra.resetLabel}${RESET}`
  );
}
