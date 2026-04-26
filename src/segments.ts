import { colorForPercentage, paint, palette, RESET, style } from "./ansi.js";

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

export function contextSegment(input: ContextInput): string {
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
  return `✍️ ${c}${pct}%${RESET}`;
}

export interface DirectoryInput {
  cwd: string;
  gitBranch?: string;
  gitDirty?: boolean;
  skipPermissions?: boolean;
}

export function directorySegment(input: DirectoryInput): string {
  const name = stripControl(basenameCrossPlatform(input.cwd) || input.cwd);
  const prefix = input.skipPermissions ? "⚡  " : "";
  let out = `${prefix}${paint(name, palette.cyan)}`;
  if (input.gitBranch) {
    const safeBranch = stripControl(input.gitBranch);
    const dirtyStar = input.gitDirty ? `${palette.red}*${palette.green}` : "";
    out += ` ${palette.green}(${safeBranch}${dirtyStar})${RESET}`;
  }
  return out;
}

export function sessionSegment(elapsedSeconds: number | undefined): string {
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
  return `${style.dim}⏱ ${RESET}${palette.white}${label}${RESET}`;
}

const EFFORT_GLYPHS: Record<string, { glyph: string; emphasis: "magenta" | "dim" }> = {
  max: { glyph: "◉", emphasis: "magenta" },
  xhigh: { glyph: "◉", emphasis: "magenta" },
  high: { glyph: "●", emphasis: "magenta" },
  medium: { glyph: "◑", emphasis: "dim" },
  low: { glyph: "◔", emphasis: "dim" },
};

export function effortSegment(level: string | undefined): string {
  if (!level) return "";
  const config = EFFORT_GLYPHS[level] ?? { glyph: "◑", emphasis: "dim" as const };
  const prefix =
    config.emphasis === "magenta" ? palette.magenta : style.dim;
  return `${prefix}${config.glyph} ${level}${RESET}`;
}

export function thinkingSegment(enabled: boolean | undefined): string {
  if (!enabled) return "";
  return paint("🧠", palette.magenta);
}
