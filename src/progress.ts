import { colorForPercentage, RESET, style } from "./ansi.js";
import type { GlyphSet } from "./glyphs.js";

export function buildBar(pct: number, width: number, glyphs: GlyphSet): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.floor((clamped * width) / 100);
  const empty = width - filled;
  const barColor = colorForPercentage(clamped);
  const filledStr = glyphs.barFilled.repeat(filled);
  const emptyStr = glyphs.barEmpty.repeat(empty);
  return `${barColor}${filledStr}${style.dim}${emptyStr}${RESET}`;
}
