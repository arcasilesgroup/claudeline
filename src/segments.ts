import { colorForPercentage, paint, palette, RESET, style } from "./ansi.js";

export function modelSegment(displayName: string | undefined): string {
  return paint(displayName && displayName.trim() !== "" ? displayName : "Claude", palette.blue);
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
    pct = Math.floor((used * 100) / input.windowSize);
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
  const parts = input.cwd.split("/").filter(Boolean);
  const name = parts.length > 0 ? parts[parts.length - 1] : input.cwd;
  const prefix = input.skipPermissions ? "⚡  " : "";
  let out = `${prefix}${paint(name ?? "", palette.cyan)}`;
  if (input.gitBranch) {
    const dirty = input.gitDirty ? `${palette.red}*` : "";
    out += ` ${palette.green}(${input.gitBranch}${dirty}${palette.green})${RESET}`;
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
