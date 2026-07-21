import { colorForPercentage, paint, palette, RESET, style } from "./ansi.js";
import type { GlyphSet } from "./glyphs.js";

// Strip C0/C1 control characters from any text we reflect from stdin
// (model.display_name, cwd, gitBranch). Defends against escape-sequence
// injection (terminal title spoofing, OSC-8 hyperlinks, screen wipes).
const stripControl = (s: string): string =>
  s.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

// Splits on both POSIX `/` and Windows `\` so the segment renders
// the basename regardless of the host that produced the cwd string.
function basenameCrossPlatform(p: string): string {
  const trimmed = p.replace(/[\/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function modelSegment(displayName: string | null | undefined): string {
  const safe =
    displayName && displayName.trim() !== ""
      ? stripControl(displayName)
      : "Claude";
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
  slot: keyof Pick<
    GlyphSet,
    "effortMax" | "effortHigh" | "effortMedium" | "effortLow"
  >;
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
  // Server-reported cost from Claude Code (`cost.total_cost_usd`). Demoted
  // to a FALLBACK (spec-001 Decision 3): used only when `current_usage` is
  // null (pre-first-call, post-`/compact`) AND the model is Anthropic. For
  // non-Anthropic models it prices against Anthropic rates and is ignored.
  totalCostUsd?: number | null | undefined;
  modelId: string | null | undefined;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  // Whether the payload carried `current_usage` this turn. When true, the
  // recomputed token cost is the primary display; when false, the server
  // cost is the only fallback. Distinguishes absent usage from zero tokens.
  hasUsage?: boolean | undefined;
  // Provider tag from the resolver. When false (non-Anthropic), the server
  // cost is never used — only the locally recomputed cost is trustworthy.
  isAnthropic?: boolean | undefined;
  // Reported context window for this turn. When 1_000_000 the recomputed
  // (estimated) cost gets the long-context surcharge; the 200_000 default
  // is priced at base rates.
  contextWindowSize?: number | undefined;
  // Top-level `exceeds_200k_tokens` flag — an alternate 1M-tier signal
  // used when the window size itself isn't reported.
  exceeds200k?: boolean | undefined;
}

// Long-context (1M) surcharge applied to the LOCALLY-RECOMPUTED cost only.
// Anthropic prices prompts beyond the 200K tier at a premium (Sonnet 4:
// input 2× at $6/MTok). sub-003 wires the tier hook with a single flat
// constant; per-field long-context rates belong to the pricing-source
// sub-spec. Server-reported cost is authoritative and never re-surcharged.
export const LONG_CONTEXT_MULTIPLIER = 2;

export interface CostResult {
  dollars: number;
  // "server" when Claude Code provided cost.total_cost_usd directly;
  // "estimated" when computed from token counts × pricing.
  source: "server" | "estimated";
}

// Single source of cost math shared by the ANSI (`costSegment`) and JSON
// (`renderStatuslineData`) render paths (§10.4 DRY). Cache read/write are
// already distinct line items on the price row; the 1M-tier surcharge is
// applied to the estimated branch only.
export function computeCost(
  input: CostInput,
  price: ModelPricing | undefined,
): CostResult | null {
  // Recompute from the reported tokens is PRIMARY (spec-001 Decision 3):
  // the tokens the provider actually reported × the live price for the
  // running model. Only attempted when usage was present this turn.
  if (price && input.hasUsage === true) {
    let dollars =
      (input.inputTokens / 1_000_000) * price.input +
      (input.cacheCreationTokens / 1_000_000) * price.cacheCreation +
      (input.cacheReadTokens / 1_000_000) * price.cacheRead +
      (input.outputTokens / 1_000_000) * price.output;
    if (input.contextWindowSize === 1_000_000 || input.exceeds200k === true) {
      dollars *= LONG_CONTEXT_MULTIPLIER;
    }
    if (Number.isFinite(dollars) && dollars > 0) {
      return { dollars, source: "estimated" };
    }
  }
  // Server cost is the FALLBACK, used only when usage is null (pre-first-
  // call, post-`/compact`) and the model is Anthropic. Non-Anthropic server
  // cost prices against Anthropic rates, so it is never used.
  if (
    input.hasUsage !== true &&
    input.isAnthropic !== false &&
    typeof input.totalCostUsd === "number" &&
    input.totalCostUsd >= 0
  ) {
    return { dollars: input.totalCostUsd, source: "server" };
  }
  return null;
}

export function costSegment(
  input: CostInput,
  pricePerMillionTokens: ModelPricing | undefined,
  glyphs: GlyphSet,
): string {
  const result = computeCost(input, pricePerMillionTokens);
  if (!result || result.dollars <= 0) return "";
  const dollars = result.dollars;
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

export function fastModeSegment(
  enabled: boolean | null | undefined,
  glyphs: GlyphSet,
): string {
  if (!enabled) return "";
  return paint(glyphs.fastMode, palette.cyan);
}

export function largeContextSegment(
  exceeds200k: boolean | null | undefined,
  glyphs: GlyphSet,
): string {
  if (!exceeds200k) return "";
  return paint(glyphs.largeContext, palette.yellow);
}

export interface LatencySummary {
  p50: number;
  p99: number;
}

export function latencySegment(
  latencyMs: number | undefined,
  glyphs: GlyphSet,
  thresholdMs = LATENCY_HIDE_BELOW_MS,
  summary?: LatencySummary,
): string {
  if (typeof latencyMs !== "number" || latencyMs < thresholdMs) return "";
  const color = latencyMs >= LATENCY_RED_AT_MS ? palette.red : palette.yellow;
  const tail = summary
    ? ` ${style.dim}(p50:${summary.p50}/p99:${summary.p99})${RESET}${color}`
    : "";
  return `${color}${glyphs.latency} ${latencyMs}ms${tail}${RESET}`;
}
