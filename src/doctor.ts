import { join } from "node:path";
import * as z from "zod/mini";
import { palette, RESET, style } from "./ansi.js";
import { adoptCachedUsage } from "./cli-shared.js";
import { statuslineInputSchema } from "./schemas.js";
import { readSettingsFile } from "./settings.js";
import { type RateState } from "./state.js";
import { VERSION } from "./version.js";

// Strip C0/C1 control characters before reflecting user-controlled
// strings into the doctor report. Same defense the renderer applies in
// segments.ts — keeps a poisoned settings.json or env var from injecting
// terminal escape sequences (title spoofing, screen wipes) into stdout.
const stripControl = (s: string): string =>
  s.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

// `runDoctor` is a pure function. Real env is injected from `cli.ts`;
// tests stub each field independently to drive every code path without
// touching the real filesystem or the user's settings.
//
// Doctor is read-only by design: it inspects state and surfaces fixes,
// never mutates settings.json, the cache, or environment. The fix
// strings are presented to the user verbatim — they choose to run them.

export type DoctorStatus = "ok" | "warn" | "error" | "info";

export interface DoctorLine {
  status: DoctorStatus;
  message: string;
  // 2-line indented action item printed beneath the status line. Only
  // attached for `warn` / `error` lines (the `Action items` subsection
  // in the spec output). Optional so info/ok lines stay terse.
  fix?: string;
}

export interface DoctorSection {
  // Section title rendered bold at the top of the group (e.g. "Diagnostics").
  title: string;
  lines: DoctorLine[];
}

export interface DoctorReport {
  // Grouped, display-oriented view: each section renders as a tree.
  // Tests can still flatten across sections via `lines` below.
  sections: DoctorSection[];
  // Flat view across all sections. Preserves the contract of pre-0.3
  // tests that walked `report.lines` directly.
  lines: DoctorLine[];
  summary: { ok: number; warnings: number; errors: number };
}

// Each check accepts (env) and returns a single DoctorLine. They are
// individually exported so a future `claudeline doctor --only foo`
// flag can run a subset without re-running the rest.

export interface DoctorEnv {
  // Read-only environment snapshot. We pass these in instead of calling
  // `process.env` etc. directly so tests stay deterministic.
  envVars: Record<string, string | undefined>;
  tmpdir: string;
  userInfo: { uid?: number };
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  // FS probes (env-injected so tests don't touch real fs).
  existsSync(path: string): boolean;
  // POSIX permissions are returned as the lower 9 bits (`0o700` etc.).
  // Returns `undefined` when the path cannot be statted.
  statMode(path: string): number | undefined;
  // Reads ~/.claude/settings.json via the shared `readSettingsFile`.
  // Tests inject a stub that returns a synthetic Settings.
  readSettings(): ReturnType<typeof readSettingsFile>;
  // Whether usage-cache.json exists at the conventional path. We split
  // existence from contents because "missing file" is normal on first
  // render but "stale shape" is a warning.
  cacheExists(): boolean;
  // Loads the raw cache contents (post-JSON parse) without applying
  // `adoptCachedUsage` — doctor needs to see the raw value to detect
  // a pre-0.2 shape vs a missing file vs a malformed entry.
  cacheLoadRaw(): unknown;
  // Whether state.json exists at the conventional path.
  stateExists(): boolean;
  stateLoad(): RateState;
  // Resolved Node and (optional) Bun versions for the engine info line.
  nodeVersion: string;
  bunVersion?: string;
}

const KNOWN_EFFORT_LEVELS = new Set(["max", "xhigh", "high", "medium", "low"]);

// Conventional cache directory layout, mirroring `cli.ts`. Keep this
// in sync with the `cacheDir` calculation in `runRender`. We use
// `path.join` so Windows separators come out right.
export function cacheDirFor(env: DoctorEnv): string {
  const uid = env.userInfo.uid ?? "shared";
  return join(env.tmpdir, `claudeline-${uid}`);
}

// 1. statusLine wired in ~/.claude/settings.json
export function checkStatusLine(env: DoctorEnv): DoctorLine {
  const settings = env.readSettings();
  const cmd = settings.statusLine?.command;
  if (!cmd || cmd.trim() === "") {
    return {
      status: "error",
      message: "statusLine not wired in ~/.claude/settings.json",
      fix: "Run `claudeline install` to wire claudeline as your statusLine.",
    };
  }
  if (!cmd.includes("claudeline")) {
    return {
      status: "warn",
      message: `statusLine.command does not reference claudeline: \"${stripControl(cmd)}\"`,
      fix: "Run `claudeline install` to overwrite, or leave as-is if intentional.",
    };
  }
  return {
    status: "ok",
    message: "statusLine wired in ~/.claude/settings.json",
  };
}

// 2. Cache directory exists with 0o700 permissions
export function checkCacheDirPerms(env: DoctorEnv): DoctorLine {
  const dir = cacheDirFor(env);
  if (!env.existsSync(dir)) {
    return {
      status: "info",
      message: "Cache directory not yet created (will be on first render)",
    };
  }
  // On Windows POSIX perms are not meaningful; report info only.
  if (env.platform === "win32") {
    return {
      status: "info",
      message: `Cache directory exists at ${dir} (perms not checked on win32)`,
    };
  }
  const mode = env.statMode(dir);
  if (mode === undefined) {
    return {
      status: "warn",
      message: `Cache directory at ${dir} could not be statted`,
      fix: "Check filesystem permissions or rerun the statusline once.",
    };
  }
  // Bits beyond 0o700 (group/other rwx) mean the dir is wider than
  // intended; flag as a warning so the user can `chmod 700`.
  if ((mode & 0o077) !== 0) {
    return {
      status: "warn",
      message: `Cache directory perms ${formatMode(mode)} are wider than 0o700`,
      fix: `Run \`chmod 700 '${dir}'\` to tighten.`,
    };
  }
  return {
    status: "ok",
    message: "Cache directory exists with 0o700 permissions",
  };
}

// 3. CLAUDE_CODE_EFFORT_LEVEL env var — THE bug we hit.
export function checkEffortLevelEnv(env: DoctorEnv): DoctorLine {
  const raw = env.envVars["CLAUDE_CODE_EFFORT_LEVEL"];
  if (raw === undefined || raw === "") {
    return {
      status: "ok",
      message: "CLAUDE_CODE_EFFORT_LEVEL is not set",
    };
  }
  return {
    status: "warn",
    message: `CLAUDE_CODE_EFFORT_LEVEL=${stripControl(raw)} in environment`,
    fix:
      "This overrides settings.json effortLevel and blocks /model.\n" +
      "Unset it or comment out the export in your shell rc to use /model freely.",
  };
}

// 4. effortLevel in settings.json
export function checkEffortLevelSetting(env: DoctorEnv): DoctorLine {
  const settings = env.readSettings();
  const value = settings.effortLevel;
  if (value === undefined || value === null || value === "") {
    return {
      status: "info",
      message: "No effortLevel in settings.json (Claude Code default applies)",
    };
  }
  if (!KNOWN_EFFORT_LEVELS.has(value)) {
    return {
      status: "error",
      message: `Unknown effortLevel \"${stripControl(value)}\" in settings.json`,
      fix:
        "Valid values: max, xhigh, high, medium, low.\n" +
        "Claude Code may ignore unknown values.",
    };
  }
  return {
    status: "ok",
    message: `effortLevel in settings.json: \"${stripControl(value)}\"`,
  };
}

// 5. Stdin schema sanity. Build a fully-populated payload that exercises
// every nullable field; if the schema rejects any of it, the build is
// broken.
const SYNTHETIC_PAYLOAD: unknown = {
  model: { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6" },
  cwd: "/tmp",
  workspace: { current_dir: "/tmp", project_dir: "/tmp" },
  session: { id: "abc", start_time: "2026-04-26T17:00:00Z" },
  context_window: {
    context_window_size: 200_000,
    used_percentage: 25,
    current_usage: {
      input_tokens: 1000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 500,
    },
  },
  effort: { level: "high" },
  thinking: { enabled: true },
  rate_limits: {
    five_hour: { used_percentage: 5, resets_at: "2026-04-26T22:30:00Z" },
    seven_day: { used_percentage: 12, resets_at: "2026-05-03T00:00:00Z" },
  },
  cost: { total_cost_usd: 1.23 },
  fast_mode: false,
  exceeds_200k_tokens: false,
};

// Optional `payload` lets tests inject a custom value; the cli wiring
// uses the no-arg form, which exercises the canonical synthetic payload.
export function checkStdinSchema(payload: unknown = SYNTHETIC_PAYLOAD): DoctorLine {
  try {
    z.parse(statuslineInputSchema, payload);
    return {
      status: "ok",
      message: "Stdin schema parses a synthetic test payload",
    };
  } catch (err) {
    return {
      status: "error",
      message: `Stdin schema rejected payload: ${(err as Error).message}`,
      fix: "This is a build bug — please file an issue with the version above.",
    };
  }
}

// 6. Cache entry shape
export function checkCacheShape(env: DoctorEnv): DoctorLine {
  if (!env.cacheExists()) {
    return {
      status: "info",
      message: "No cache entry yet (will populate on next render)",
    };
  }
  const raw = env.cacheLoadRaw();
  // The cli wires `cacheLoadRaw` with TTL = Number.MAX_SAFE_INTEGER, so
  // freshness can never be the cause of `undefined` here. The only ways
  // `loadJson` can return undefined for an existing file are: malformed
  // JSON, the safety layer rejected a symlink, or the read itself
  // failed. All of those merit a warning, not an "ok".
  if (raw === undefined) {
    return {
      status: "warn",
      message: "Cache file unreadable (malformed JSON, symlink, or perms)",
      fix: `Delete \`${cacheDirFor(env)}/usage-cache.json\`; it will rebuild on next render.`,
    };
  }
  const adopted = adoptCachedUsage(raw);
  if (adopted === undefined) {
    return {
      status: "warn",
      message: "Stale cache entry detected (will self-heal in <=60 s)",
      fix: "No action needed — `adoptCachedUsage` will discard it on next render.",
    };
  }
  return {
    status: "ok",
    message: "Cache entry shape parses cleanly",
  };
}

// 7. State file shape
export function checkStateShape(env: DoctorEnv): DoctorLine {
  if (!env.stateExists()) {
    return {
      status: "info",
      message: "No state file yet (will populate on next render)",
    };
  }
  const state = env.stateLoad();
  // Empty object means `loadState` rejected the contents (likely an old
  // shape from a previous version or corrupted JSON). The user can let
  // it self-heal but we still flag it so they know why their burn-rate
  // projection didn't show up.
  if (Object.keys(state).length === 0) {
    return {
      status: "warn",
      message: "State file exists but parses to empty (probably old shape)",
      fix: "Safe to delete — `claudeline render` will re-create it next time.",
    };
  }
  return {
    status: "ok",
    message: "State file shape parses cleanly",
  };
}

// 8. Bun/Node engine info
export function checkEngine(env: DoctorEnv): DoctorLine {
  const node = env.nodeVersion;
  const bun = env.bunVersion;
  const detail = bun ? `Node ${node} / Bun ${bun}` : `Node ${node}`;
  return { status: "info", message: `Engine: ${detail}` };
}

// Diagnostics block is pure info — facts about the running environment.
// Composed inline so we don't grow the per-check public surface for
// trivial constants. Tests exercise these via `runDoctor` composition.
function diagnosticsLines(env: DoctorEnv): DoctorLine[] {
  return [
    { status: "info", message: `Version: claudeline ${VERSION}` },
    checkEngine(env),
    { status: "info", message: `Platform: ${env.platform}-${env.arch}` },
    { status: "info", message: `Cache directory: ${cacheDirFor(env)}` },
  ];
}

// Compose all checks into sections. Section order is the visual order
// the user sees: facts → settings → operational health.
export function runDoctor(env: DoctorEnv): DoctorReport {
  const sections: DoctorSection[] = [
    { title: "Diagnostics", lines: diagnosticsLines(env) },
    {
      title: "Configuration",
      lines: [
        checkStatusLine(env),
        checkEffortLevelEnv(env),
        checkEffortLevelSetting(env),
        checkCacheDirPerms(env),
        checkStdinSchema(),
      ],
    },
    {
      title: "Health",
      lines: [checkCacheShape(env), checkStateShape(env)],
    },
  ];

  const lines = sections.flatMap((s) => s.lines);
  const summary = lines.reduce(
    (acc, line) => {
      if (line.status === "ok") acc.ok += 1;
      else if (line.status === "warn") acc.warnings += 1;
      else if (line.status === "error") acc.errors += 1;
      return acc;
    },
    { ok: 0, warnings: 0, errors: 0 },
  );

  return { sections, lines, summary };
}

// --- Formatting -----------------------------------------------------
//
// Output style mirrors `claude doctor` and the conventions in
// clig.dev: bold section titles, tree branches via U+251C / U+2514,
// issues surfaced in their own block beneath the sections (eye is
// drawn to the end of the output, per clig.dev). NO_COLOR is honored
// when the cli's `printReport({ color: false })` opt-out is wired.

// U+251C, U+2514, U+2500. BMP box-drawing chars; render in any
// modern monospace terminal font without a NerdFont.
const TREE_BRANCH = "├";
const TREE_LAST = "└";
const TREE_RULE = "─";

const ISSUE_ICON: Record<"warn" | "error", string> = {
  warn: "⚠",
  error: "✗",
};

const ISSUE_COLOR: Record<"warn" | "error", string> = {
  warn: palette.yellow,
  error: palette.red,
};

export interface PrintReportOptions {
  // Default true. Pass false to strip ANSI for NO_COLOR / pipes / dumb
  // terminals (cli.ts decides based on env + isTTY).
  color?: boolean;
}

export function printReport(
  report: DoctorReport,
  opts: PrintReportOptions = {},
): string {
  const color = opts.color !== false;
  const c = (open: string, body: string): string =>
    color ? `${open}${body}${RESET}` : body;

  const out: string[] = [];
  // Top rule — visual anchor that the report has begun. clig.dev:
  // "Bold headings make it much easier to scan."
  out.push(c(style.dim, TREE_RULE.repeat(72)));
  out.push("");

  // Render each section's OK/info lines as tree leaves. Warn/error
  // lines bubble out to the issues block below — the eye lands there.
  for (const section of report.sections) {
    const leaves = section.lines.filter(
      (l) => l.status === "ok" || l.status === "info",
    );
    if (leaves.length === 0) continue;
    out.push(`  ${c(style.bold, section.title)}`);
    leaves.forEach((line, i) => {
      const branch = i === leaves.length - 1 ? TREE_LAST : TREE_BRANCH;
      out.push(`  ${c(style.dim, branch)} ${line.message}`);
    });
    out.push("");
  }

  // Issues block. Order preserves the section traversal so the user
  // can correlate a warning back to where the fact lives.
  const issues = report.lines.filter(
    (l) => l.status === "warn" || l.status === "error",
  );
  for (const issue of issues) {
    const status = issue.status as "warn" | "error";
    const icon = ISSUE_ICON[status];
    const tone = ISSUE_COLOR[status];
    out.push(`  ${c(tone, icon)} ${c(tone, issue.message)}`);
    if (issue.fix) {
      const fixLines = issue.fix.split("\n");
      fixLines.forEach((fl, i) => {
        const branch = i === fixLines.length - 1 ? TREE_LAST : TREE_BRANCH;
        out.push(`    ${c(style.dim, `${branch} ${fl}`)}`);
      });
    }
    out.push("");
  }

  // Summary, formatted to read as a sentence.
  const { ok, warnings, errors } = report.summary;
  const errs = `${errors} ${errors === 1 ? "error" : "errors"}`;
  const warns = `${warnings} ${warnings === 1 ? "warning" : "warnings"}`;
  out.push(`  ${c(style.bold, "Summary:")} ${errs}, ${warns}, ${ok} ok`);

  return out.join("\n");
}

function formatMode(mode: number): string {
  // Render as `0o755` etc. — three octal digits is enough for a directory.
  return `0o${(mode & 0o777).toString(8).padStart(3, "0")}`;
}
