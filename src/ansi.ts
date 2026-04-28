export const RESET = "\x1b[0m";

export const style = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
} as const;

export function color(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

export const palette = {
  blue: color(0, 153, 255),
  cyan: color(86, 182, 194),
  green: color(0, 175, 80),
  orange: color(255, 176, 85),
  yellow: color(230, 200, 0),
  red: color(255, 85, 85),
  magenta: color(180, 140, 255),
  white: color(220, 220, 220),
} as const;

// `enabled` lets callers gate color centrally (NO_COLOR / TERM=dumb /
// non-TTY pipes). Default true preserves the previous behaviour for
// callers like `segments.ts` that always want color when invoked.
export function paint(text: string, ansi: string, enabled = true): string {
  return enabled ? `${ansi}${text}${RESET}` : text;
}

export function colorForPercentage(pct: number): string {
  const clamped = Math.max(0, pct);
  if (clamped >= 90) return palette.red;
  if (clamped >= 70) return palette.yellow;
  if (clamped >= 50) return palette.orange;
  return palette.green;
}
