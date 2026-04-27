import { colorForPercentage, paint, palette, RESET, style } from "./ansi.js";
import type { GlyphSet } from "./glyphs.js";

// Strip C0/C1 control characters from any text we reflect from stdin
// (model.display_name, cwd, gitBranch). Defends against escape-sequence
// injection (terminal title spoofing, OSC-8 hyperlinks, screen wipes).
const stripControl = (s: string): string => s.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

// Splits on both POSIX `/` and Windows `\` so the segment renders
// the basename regardless of the host that produced the cwd string.
function basenameCrossPlatform(p: string): string {
  const trimmed = p.replace(/[\/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function modelSegment(displayName: string | null | undefined): string {
  const safe = displayName && displayName.trim() !== "" ? stripControl(displayName) : "Claude";
  return paint(safe, palette.blue);
}

export interface ContextInput {
  windowSize: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  usedPercentage?: number;
}

export function contextSegment(input: ContextInput, glyphs: GlyphSet): string {
  let pct: number;
  if (typeof input.usedPercentage === "number") {
    pct = Math.round(input.usedPercentage);
  } else if (input.windowSize > 0) {
    const used =
      input.inputTokens + input.cacheCreationTokens + input.cacheReadTokens;
    pct = Math.round((used * 100) / input.windowSize);
  } else {
    pct = 0;
  }
  const c = colorForPercentage(pct);
  return `${glyphs.context} ${c}${pct}%${RESET}`;
}

export interface DirectoryInput {
  cwd: string;
  gitBranch?: string;
  gitDirty?: boolean;
  gitWorktree?: boolean;
  skipPermissions?: boolean;
}

export function directorySegment(
  input: DirectoryInput,
  glyphs: GlyphSet,
): string {
  const name = stripControl(basenameCrossPlatform(input.cwd) || input.cwd);
  const prefix = input.skipPermissions ? `${glyphs.skipPermissions}  ` : "";
  let out = `${prefix}${paint(name, palette.cyan)}`;
  if (input.gitBranch) {
    const safeBranch = stripControl(input.gitBranch);
    const dirtyStar = input.gitDirty ? `${palette.red}*${palette.green}` : "";
    const wtMark = input.gitWorktree ? `${glyphs.worktree}:` : "";
    out += ` ${palette.green}(${wtMark}${safeBranch}${dirtyStar})${RESET}`;
  }
  return out;
}

export function sessionSegment(
  elapsedSeconds: number | undefined,
  glyphs: GlyphSet,
): string {
  if (typeof elapsedSeconds !== "number" || elapsedSeconds < 0) return "";
  let label: string;
  if (elapsedSeconds >= 3600) {
    label = `${Math.floor(elapsedSeconds / 3600)}h${Math.floor(
      (elapsedSeconds % 3600) / 60,
    )}m`;
  } else if (elapsedSeconds >= 60) {
    label = `${Math.floor(elapsedSeconds / 60)}m`;
  } else {
    label = `${elapsedSeconds}s`;
  }
  return `${style.dim}${glyphs.clock} ${RESET}${palette.white}${label}${RESET}`;
}

interface EffortConfig {
  slot: keyof Pick<GlyphSet, "effortMax" | "effortHigh" | "effortMedium" | "effortLow">;
  emphasis: "magenta" | "dim";
}

const EFFORT_TABLE: Record<string, EffortConfig> = {
  max: { slot: "effortMax", emphasis: "magenta" },
  xhigh: { slot: "effortMax", emphasis: "magenta" },
  high: { slot: "effortHigh", emphasis: "magenta" },
  medium: { slot: "effortMedium", emphasis: "dim" },
  low: { slot: "effortLow", emphasis: "dim" },
};

const FALLBACK_EFFORT: EffortConfig = {
  slot: "effortMedium",
  emphasis: "dim",
};

export function effortSegment(
  level: string | undefined,
  glyphs: GlyphSet,
): string {
  if (!level) return "";
  const config = EFFORT_TABLE[level] ?? FALLBACK_EFFORT;
  const prefix = config.emphasis === "magenta" ? palette.magenta : style.dim;
  return `${prefix}${glyphs[config.slot]} ${level}${RESET}`;
}

export function thinkingSegment(
  enabled: boolean | undefined,
  glyphs: GlyphSet,
): string {
  if (!enabled) return "";
  return paint(glyphs.brain, palette.magenta);
}

export interface CostInput {
  modelId: string | null | undefined;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export function costSegment(
  input: CostInput,
  pricePerMillionTokens: ModelPricing | undefined,
  glyphs: GlyphSet,
): string {
  if (!pricePerMillionTokens) return "";
  const dollars =
    (input.inputTokens / 1_000_000) * pricePerMillionTokens.input +
    (input.cacheCreationTokens / 1_000_000) *
      pricePerMillionTokens.cacheCreation +
    (input.cacheReadTokens / 1_000_000) * pricePerMillionTokens.cacheRead +
    (input.outputTokens / 1_000_000) * pricePerMillionTokens.output;
  if (dollars <= 0) return "";
  const formatted = dollars >= 1 ? dollars.toFixed(2) : dollars.toFixed(3);
  return `${glyphs.cost} ${palette.yellow}$${formatted}${RESET}`;
}

export interface ModelPricing {
  // USD per 1M tokens
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

// Latency thresholds for the slow-API badge. The yellow/red split lets a
// user distinguish "noticeably slow" from "API is having a bad day".
export const LATENCY_HIDE_BELOW_MS = 1000;
export const LATENCY_RED_AT_MS = 3000;

export function latencySegment(
  latencyMs: number | undefined,
  glyphs: GlyphSet,
  thresholdMs = LATENCY_HIDE_BELOW_MS,
): string {
  if (typeof latencyMs !== "number" || latencyMs < thresholdMs) return "";
  const color = latencyMs >= LATENCY_RED_AT_MS ? palette.red : palette.yellow;
  return `${color}${glyphs.latency} ${latencyMs}ms${RESET}`;
}
