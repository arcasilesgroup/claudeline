import { colorForPercentage, RESET, style } from "./ansi.js";

export function buildBar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.floor((clamped * width) / 100);
  const empty = width - filled;
  const barColor = colorForPercentage(clamped);
  const filledStr = "●".repeat(filled);
  const emptyStr = "○".repeat(empty);
  return `${barColor}${filledStr}${style.dim}${emptyStr}${RESET}`;
}
