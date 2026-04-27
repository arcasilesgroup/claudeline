// Glyph table for the three rendering modes.
//
// `emoji` (default) keeps the colorful emoji + Unicode geometric mix used
// since 0.1.0. `nerd` swaps the slots that have a clean NerdFont
// equivalent for tighter, monoline iconography. `plain` is ASCII-only for
// SSH sessions on terminals without emoji or Powerline support.
//
// We deliberately keep emojis (✍️, 🧠, 💸, 💵) in the `nerd` mode too —
// they look great and NerdFont fonts render emojis correctly. We only
// switch slots whose default (⏱, ⟳, ⚡, ◉/●/◑/◔, ●/○) has a meaningfully
// nicer NerdFont icon. The goal is "still beautiful", not "all icons
// replaced".

export type GlyphMode = "emoji" | "nerd" | "plain";

export interface GlyphSet {
  // Decoration / structure
  separator: string;
  resetArrow: string;
  skipPermissions: string;
  // Segments
  context: string;
  clock: string;
  brain: string;
  cost: string;
  latency: string;
  worktree: string;
  fastMode: string;
  largeContext: string;
  // Effort levels
  effortMax: string;
  effortHigh: string;
  effortMedium: string;
  effortLow: string;
  // Progress bar cells
  barFilled: string;
  barEmpty: string;
}

const EMOJI: GlyphSet = {
  separator: "│",
  resetArrow: "⟳",
  // skipPermissions and latency are intentionally different to avoid
  // ambiguity when both segments appear on the same line — `⚡` for
  // "running with --dangerously-skip-permissions" (a danger signal),
  // `🐢` for "the API is slow right now" (a latency signal).
  skipPermissions: "⚡",
  context: "✍️",
  clock: "⏱",
  brain: "🧠",
  cost: "💸",
  latency: "🐢",
  worktree: "⎇",
  // `--fast` mode → bunny (universally legible "speed" glyph).
  // Large context (>200K tokens) → book stack (gentle "you're getting big" hint).
  fastMode: "🐇",
  largeContext: "📚",
  effortMax: "◉",
  effortHigh: "●",
  effortMedium: "◑",
  effortLow: "◔",
  barFilled: "●",
  barEmpty: "○",
};

// NerdFont private-use codepoints. Sourced from the NerdFont cheat sheet
// (https://www.nerdfonts.com/cheat-sheet). Verified to render in iTerm2,
// kitty, alacritty, wezterm, Windows Terminal with any patched NerdFont.
//
// Glyphs are written as explicit `\uXXXX` escapes so editors that don't
// render NerdFont private-use codepoints can't silently strip them (this
// happened during a 0.3.0 refactor and only the compatibility review
// caught it before release).
const NERD: GlyphSet = {
  separator: "\ue0b1", // nf-pl-left_soft_divider
  resetArrow: "\uf021", // nf-fa-refresh
  skipPermissions: "\uf0e7", // nf-fa-bolt
  context: "\u270d\ufe0f", // emoji preserved (renders fine with NerdFont)
  clock: "\uf017", // nf-fa-clock_o
  brain: "\u{1F9E0}", // emoji preserved
  cost: "\u{1F4B8}", // emoji preserved
  latency: "\uf0e7", // nf-fa-bolt
  worktree: "\ue725", // nf-dev-git_branch
  fastMode: "\u{1F407}", // emoji preserved (NerdFont has no clean "speed" glyph)
  largeContext: "\uf02d", // nf-fa-book
  effortMax: "\uf111", // nf-fa-circle (filled)
  effortHigh: "\uf111",
  effortMedium: "\uf192", // nf-fa-dot_circle
  effortLow: "\uf10c", // nf-fa-circle_o
  barFilled: "\uf111",
  barEmpty: "\uf10c",
};

const PLAIN: GlyphSet = {
  separator: "|",
  resetArrow: ">",
  skipPermissions: "!",
  context: "ctx:",
  clock: "t:",
  brain: "[T]",
  // `cost` glyph is a label prefix; the dollar sign comes from the
  // formatted amount (`$2.25`). Using "$" here would produce "$ $2.25".
  cost: "cost:",
  latency: "lat:",
  worktree: "wt",
  fastMode: "fast",
  largeContext: "1M+",
  effortMax: "++",
  effortHigh: "+",
  effortMedium: "=",
  effortLow: "-",
  barFilled: "#",
  barEmpty: ".",
};

const TABLE: Record<GlyphMode, GlyphSet> = {
  emoji: EMOJI,
  nerd: NERD,
  plain: PLAIN,
};

export function glyphsFor(mode: GlyphMode): GlyphSet {
  return TABLE[mode];
}

export function parseGlyphMode(raw: string | undefined): GlyphMode {
  if (raw === "nerd" || raw === "plain") return raw;
  return "emoji";
}
