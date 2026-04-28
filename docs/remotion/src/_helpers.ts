import { interpolate, Easing } from "remotion";

// Shared visual constants across the demo compositions. The base palette
// here mirrors src/ansi.ts in the main package so both gifs feel like the
// real ANSI output. Compositions that need a different shade of `dim`
// (the CLI demo wants more contrast against the panel) override locally.
export const BASE_COLORS = {
  bg: "#0d1117",        // GitHub dark — both outer canvas and inner panel
  outer: "#08090c",     // Slightly darker outer bg so the rounded panel edge reads
  panelBorder: "#1f2937", // Subtle hairline around the rounded panel
  cyan: "rgb(86, 182, 194)",
  green: "rgb(0, 175, 80)",
  yellow: "rgb(230, 200, 0)",
  red: "rgb(255, 85, 85)",
  white: "rgb(220, 220, 220)",
} as const;

// Statusline-specific extras (badges that don't appear in the doctor demo).
export const EXTRA_COLORS = {
  blue: "rgb(0, 153, 255)",
  orange: "rgb(255, 176, 85)",
  magenta: "rgb(180, 140, 255)",
} as const;

export const FONT =
  "'JetBrains Mono', 'Cascadia Code', 'Menlo', 'Monaco', 'Courier New', monospace";

// Color thresholds match ansi.ts:colorForPercentage. Kept here so the
// gif and the live ANSI output agree on which threshold flips colour.
export function colorForPct(pct: number): string {
  if (pct >= 90) return BASE_COLORS.red;
  if (pct >= 70) return BASE_COLORS.yellow;
  if (pct >= 50) return "rgb(255, 176, 85)"; // orange — kept inline so this fn doesn't pull in EXTRA_COLORS
  return BASE_COLORS.green;
}

// Smooth fade/slide-in helper. Returns `{ opacity, transform }` for the
// element appearing at `startFrame`. The default duration of 8 matches
// the CLI composition; the Statusline pass-through uses 12 (slower
// "settling" motion fits a stable ribbon better than a doctor reveal).
export function appearAt(
  frame: number,
  startFrame: number,
  duration = 8,
): { opacity: number; transform: string } {
  const opacity = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.ease),
    },
  );
  const translate = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [4, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.ease),
    },
  );
  return { opacity, transform: `translateY(${translate}px)` };
}
