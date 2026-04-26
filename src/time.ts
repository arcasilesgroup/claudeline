export type TimeStyle = "time" | "datetime" | "date";

export interface Detect24HourInput {
  force24h?: boolean;
  appleLocale?: string;
  env: Record<string, string | undefined>;
}

const TWELVE_HOUR_REGIONS = new Set(["US", "CA"]);

function regionFromLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  const cleaned = locale.split(".")[0]?.split("@")[0];
  if (!cleaned) return undefined;
  const parts = cleaned.split("_");
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

export function detect24Hour(input: Detect24HourInput): boolean {
  if (typeof input.force24h === "boolean") return input.force24h;

  const localeFromEnv =
    input.env["LC_TIME"] ?? input.env["LC_ALL"] ?? input.env["LANG"];
  const region =
    regionFromLocale(input.appleLocale) ?? regionFromLocale(localeFromEnv);

  if (!region) return true;
  return !TWELVE_HOUR_REGIONS.has(region.toUpperCase());
}

export interface FormatEpochOptions {
  style: TimeStyle;
  use24h: boolean;
  timeZone?: string;
  locale?: string;
}

export function formatEpoch(
  epochSeconds: number,
  options: FormatEpochOptions,
): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "";

  const date = new Date(epochSeconds * 1000);
  const { style, use24h, timeZone, locale = "en-US" } = options;

  const timeOpts: Intl.DateTimeFormatOptions = use24h
    ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : { hour: "numeric", minute: "2-digit", hourCycle: "h12" };

  if (timeZone) timeOpts.timeZone = timeZone;

  const formatTime = () =>
    cleanupTime(new Intl.DateTimeFormat(locale, timeOpts).format(date), use24h);

  if (style === "time") return formatTime();

  const dateOpts: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};
  const day = date.toLocaleDateString(locale, { ...dateOpts, day: "numeric" });
  const month = date
    .toLocaleDateString(locale, { ...dateOpts, month: "short" })
    .toLowerCase()
    .replace(/\./g, "");

  const dateStr = use24h ? `${day} ${month}` : `${month} ${day}`;
  return style === "date" ? dateStr : `${dateStr}, ${formatTime()}`;
}

function cleanupTime(raw: string, use24h: boolean): string {
  let out = raw.toLowerCase().replace(/\./g, "").trim();
  if (!use24h) {
    out = out.replace(/\s+/g, "");
  }
  return out;
}

export function parseIsoToEpoch(
  value: string | number | null | undefined,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === "") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}
