import { spawn } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod/mini";
import { fetchUsage } from "./api.js";
import {
  adoptCachedUsage,
  loadJsonCache,
  loadJsonCacheWithAge,
  saveJsonCache,
} from "./cache.js";
import { defaultCredentialSources, loadOAuthToken } from "./credentials.js";
import { type DoctorEnv, printReport, runDoctor } from "./doctor.js";
import { getGitInfo } from "./git.js";
import { glyphsFor, parseGlyphMode } from "./glyphs.js";
import { install, uninstall } from "./installer.js";
import { detectSkipPermissions, detectTimezone, readMacDefault } from "./platform.js";
import {
  type CachedUsage,
  type CachedUsageWithAge,
  renderStatusline,
  renderStatuslineData,
} from "./render.js";
import {
  type StatuslineInput,
  statuslineInputSchema,
} from "./schemas.js";
import {
  type SessionRecord,
  appendSessionRecord,
  defaultSessionLogPaths,
  disableSessionLog,
  enableSessionLog,
  isSessionLogEnabled,
  summarize,
} from "./sessionLog.js";
import { defaultSettingsPath, readSettingsFile } from "./settings.js";
import { type RateState, loadState, saveState } from "./state.js";
import { detect24Hour } from "./time.js";
import { VERSION } from "./version.js";

const HELP = `claudeline ${VERSION} — cross-platform statusline for Claude Code

Usage:
  claudeline render                Read JSON from stdin and emit the statusline
  claudeline render --json         Same input, structured JSON output (for editors/scripts)
  claudeline install               Wire claudeline as the statusLine in ~/.claude/settings.json
  claudeline uninstall             Remove claudeline from ~/.claude/settings.json
  claudeline doctor                Run diagnostics and print a pass/warn/fail report
  claudeline doctor --json         Same checks, structured JSON output (for scripts/editors)
  claudeline summary               Show local session history (cost, models, top windows)
  claudeline summary --enable      Start tracking sessions in ~/.claudeline/sessions.jsonl
  claudeline summary --disable     Stop tracking and delete the local session log
  claudeline refresh               Force a fresh OAuth-API fetch (bypasses the 30s cache)
  claudeline --help                Show this help
  claudeline --version             Show version

Configuration:
  - .effort.level / .thinking.enabled / model.id from stdin (Claude Code runtime)
  - effortLevel / alwaysThinkingEnabled from ~/.claude/settings.json (fallback)
  - Rate limits: stdin first, otherwise OAuth API (cached 60s)
  - Cost: server-side cost.total_cost_usd from Claude Code (preferred);
    falls back to token counts × Anthropic public pricing
  - CLAUDELINE_GLYPHS=emoji|nerd|plain (default emoji); plain works on
    terminals without Unicode/emoji rendering, nerd assumes a NerdFont

Repo: https://github.com/arcasilesgroup/claudeline
`;

async function main(): Promise<number> {
  const cmd = process.argv[2];

  if (cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (cmd === "install") {
    install({ settingsPath: defaultSettingsPath(), platform: platform() });
    process.stdout.write(
      "claudeline installed. Restart Claude Code to apply.\n",
    );
    return 0;
  }

  if (cmd === "uninstall") {
    uninstall({ settingsPath: defaultSettingsPath() });
    process.stdout.write(
      "claudeline removed. Restart Claude Code to apply.\n",
    );
    return 0;
  }

  if (cmd === "doctor") {
    // Pass the raw argv tail so runDoctorCmd can sniff `--json`. We
    // avoid yargs/commander to keep the dependency surface at zero.
    return runDoctorCmd(process.argv.slice(3));
  }

  if (cmd === "summary") {
    return runSummaryCmd(process.argv.slice(3));
  }

  if (cmd === "refresh") {
    return await runRefreshCmd();
  }

  // Internal subcommand used by stale-while-revalidate spawns. Hidden
  // from `--help` because it has no UX value to surface — it's the
  // background fetch claudeline kicks off when the cache crosses the
  // SWR threshold. Idempotent: safe to call any time, no output, exits
  // 0 unless something went really wrong.
  if (cmd === "_refresh") {
    return await runInternalRefreshCmd();
  }

  if (cmd === "render" || cmd === undefined) {
    return await runRender(process.argv.slice(3));
  }

  process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
  return 2;
}

// Run all diagnostic checks and print a pass/fail report. Always
// returns 0 — `doctor` is informational; the tool itself is functional
// even when a check warns. We surface failures via stdout, not exit
// code, so a CI-style `claudeline doctor || exit 1` would need to grep
// the output (intentional: doctor warnings are not test failures).
//
// `--json` swaps the human-readable tree for a structured JSON dump
// (sections + summary + meta) so editors, dashboards, and scripts can
// consume the report without parsing ANSI.
function runDoctorCmd(args: string[]): number {
  const env = buildRealDoctorEnv();
  const report = runDoctor(env);

  if (args.includes("--json")) {
    // Schema is documented in the README under `claudeline doctor --json`.
    // Keep this stable across patches — third-party tooling may rely on it.
    const out = {
      version: VERSION,
      generated_at: new Date().toISOString(),
      sections: report.sections.map((s) => ({
        title: s.title,
        lines: s.lines.map((l) => ({
          status: l.status,
          message: l.message,
          ...(l.fix !== undefined ? { fix: l.fix } : {}),
        })),
      })),
      summary: report.summary,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return 0;
  }

  // Honor NO_COLOR (https://no-color.org) and pipe-to-not-a-tty per
  // clig.dev: "Disable color if stdout is not an interactive terminal."
  const useColor =
    !process.env["NO_COLOR"] &&
    process.env["TERM"] !== "dumb" &&
    process.stdout.isTTY === true;
  process.stdout.write(`${printReport(report, { color: useColor })}\n`);
  return 0;
}

function buildRealDoctorEnv(): DoctorEnv {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const cacheDir = join(
    tmpdir(),
    `claudeline-${uid ?? "shared"}`,
  );
  const cachePath = join(cacheDir, "usage-cache.json");
  const statePath = join(cacheDir, "state.json");
  const settingsPath = defaultSettingsPath();

  const env: DoctorEnv = {
    envVars: process.env,
    tmpdir: tmpdir(),
    userInfo: uid !== undefined ? { uid } : {},
    platform: platform(),
    arch: arch() as NodeJS.Architecture,
    existsSync: (p: string) => existsSync(p),
    statMode: (p: string) => {
      try {
        // `lstatSync` so a symlinked cache dir doesn't quietly hide
        // wrong perms; we want the perms of the entry the user owns.
        return lstatSync(p).mode;
      } catch {
        return undefined;
      }
    },
    readSettings: () => readSettingsFile(settingsPath),
    cacheExists: () => existsSync(cachePath),
    // Pass `Infinity` as the TTL so the doctor sees the raw on-disk
    // entry regardless of freshness — we want to flag stale shapes,
    // not stale freshness.
    cacheLoadRaw: () => loadJsonCache<unknown>(cachePath, Infinity),
    stateExists: () => existsSync(statePath),
    stateLoad: () => loadState(statePath),
    nodeVersion: process.versions.node,
    cacheAgeMs: () => {
      const meta = loadJsonCacheWithAge<unknown>(cachePath);
      return meta ? Math.max(0, Date.now() - meta.mtimeMs) : undefined;
    },
    cacheTtlMs: resolveCacheTtlMs(process.env["CLAUDELINE_CACHE_TTL_SEC"]),
    preferApi: parseBooleanEnv(process.env["CLAUDELINE_PREFER_API"]),
  };

  const bunVersion = process.versions["bun"];
  if (bunVersion) env.bunVersion = bunVersion;
  return env;
}

async function runRender(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const raw = await readStdin();
  if (!raw.trim()) {
    if (json) {
      // Stable empty-state response so editors can probe with no stdin
      // and still get a parseable shape.
      process.stdout.write(`${JSON.stringify({ version: VERSION, error: "no_stdin" })}\n`);
      return 0;
    }
    process.stdout.write("Claude\n");
    return 0;
  }

  let parsed: StatuslineInput;
  try {
    parsed = z.parse(statuslineInputSchema, JSON.parse(raw));
  } catch {
    if (json) {
      process.stdout.write(`${JSON.stringify({ version: VERSION, error: "invalid_input" })}\n`);
      return 0;
    }
    process.stdout.write("Claude\n");
    return 0;
  }

  // Per-uid subdir so that on shared hosts a co-tenant cannot plant
  // symlinks in our namespace or read our cache. The `0o700` mkdir +
  // `0o600` write in cache.ts hold inside this directory.
  const uid = typeof process.getuid === "function" ? process.getuid() : "shared";
  const cacheDir = join(tmpdir(), `claudeline-${uid}`);
  const cachePath = join(cacheDir, "usage-cache.json");
  const statePath = join(cacheDir, "state.json");
  const force24 = parseForce24(readMacDefault("AppleICUForce24HourTime"));
  const appleLocale = readMacDefault("AppleLocale");

  const detect24Input: Parameters<typeof detect24Hour>[0] = { env: process.env };
  if (typeof force24 === "boolean") detect24Input.force24h = force24;
  if (appleLocale) detect24Input.appleLocale = appleLocale;

  const use24h = detect24Hour(detect24Input);
  const tz = detectTimezone();
  const glyphs = glyphsFor(parseGlyphMode(process.env["CLAUDELINE_GLYPHS"]));

  const credentialSources = defaultCredentialSources();
  const ttlMs = resolveCacheTtlMs(process.env["CLAUDELINE_CACHE_TTL_SEC"]);

  const deps = {
    readSettings: () => readSettingsFile(),
    getGitInfo,
    detect24Hour: use24h,
    ...(tz ? { timeZone: tz } : {}),
    now: () => Date.now(),
    skipPermissions: detectSkipPermissions(),
    glyphs,
    loadToken: () => loadOAuthToken(credentialSources),
    fetchUsage: async (token: string) => fetchUsage(token),
    cacheLoad: (): CachedUsageWithAge | undefined => {
      const meta = loadJsonCacheWithAge<unknown>(cachePath);
      if (!meta) return undefined;
      const ageMs = Date.now() - meta.mtimeMs;
      // Beyond TTL we discard — render should fetch synchronously so
      // the user doesn't see day-old numbers after a sleep/wake cycle.
      if (ageMs > ttlMs) return undefined;
      const adopted = adoptCachedUsage(meta.data);
      if (!adopted) return undefined;
      return { cache: adopted, ageMs };
    },
    cacheSave: (data: CachedUsage) => saveJsonCache(cachePath, data),
    refreshInBackground: () => spawnDetachedRefresh(),
    preferApi: parseBooleanEnv(process.env["CLAUDELINE_PREFER_API"]),
    loadState: (): RateState => loadState(statePath),
    saveState: (state: RateState) => saveState(statePath, state),
  };

  if (json) {
    const data = await renderStatuslineData(parsed, deps, { version: VERSION });
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    logSessionIfEnabled(parsed, deps);
    return 0;
  }

  const out = await renderStatusline(parsed, deps);
  process.stdout.write(`${out}\n`);
  logSessionIfEnabled(parsed, deps);
  return 0;
}

// Persist a session record only when the user has opted in (the log
// file exists). The probe is a single existsSync — sub-millisecond on a
// warm cache — so users who never enable logging pay no measurable
// cost. Errors are swallowed inside `appendSessionRecord` so logging
// never disrupts a live render.
function logSessionIfEnabled(
  input: StatuslineInput,
  deps: { getGitInfo: typeof getGitInfo; skipPermissions: boolean },
): void {
  const sessionId = input.session?.id;
  if (!sessionId) return;
  const paths = defaultSessionLogPaths();
  if (!isSessionLogEnabled(paths)) return;

  const cwd = input.cwd ?? input.workspace?.current_dir ?? null;
  const gitBranch = cwd ? deps.getGitInfo(cwd).branch ?? null : null;
  const record: SessionRecord = {
    v: 1,
    session_id: sessionId,
    started_at: input.session?.start_time ?? null,
    logged_at: new Date().toISOString(),
    model_id: input.model?.id ?? null,
    model_display_name: input.model?.display_name ?? null,
    cost_usd:
      typeof input.cost?.total_cost_usd === "number"
        ? input.cost.total_cost_usd
        : null,
    cwd,
    git_branch: gitBranch,
    exceeds_200k_tokens: input.exceeds_200k_tokens === true,
    fast_mode: input.fast_mode === true,
  };
  appendSessionRecord(paths, record);
}

// Read-only by default (just prints the rolled-up view). `--enable` /
// `--disable` toggle local-only tracking. `--json` swaps the table for
// a structured object.
function runSummaryCmd(args: string[]): number {
  const paths = defaultSessionLogPaths();

  if (args.includes("--enable")) {
    enableSessionLog(paths);
    process.stdout.write(
      `Tracking enabled. Future sessions will be logged to ${paths.file}.\n` +
        "All data stays local. Run `claudeline summary --disable` to stop and delete.\n",
    );
    return 0;
  }

  if (args.includes("--disable")) {
    disableSessionLog(paths);
    process.stdout.write(`Tracking disabled. Removed ${paths.file}.\n`);
    return 0;
  }

  if (!isSessionLogEnabled(paths)) {
    process.stdout.write(
      "No local session log found.\n" +
        "Run `claudeline summary --enable` to start tracking cost / model usage per session.\n" +
        "All data stays on this machine. See `claudeline --help` for details.\n",
    );
    return 0;
  }

  const summary = summarize(paths);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(formatSummary(summary));
  return 0;
}

function formatSummary(s: ReturnType<typeof summarize>): string {
  const out: string[] = [];
  out.push("");
  out.push(`  ${bold("claudeline summary")}`);
  out.push(`  ${dim(`log: ${s.log_file}`)}`);
  out.push("");

  const windows: Array<keyof typeof s.windows> = [
    "today",
    "this_week",
    "this_month",
    "all_time",
  ];
  for (const key of windows) {
    const w = s.windows[key];
    out.push(`  ${bold(w.label.padEnd(11))} ${formatCost(w.total_cost_usd)} across ${w.sessions} session${w.sessions === 1 ? "" : "s"}`);
    if (w.by_model.length > 0 && w.sessions > 0) {
      const top = w.by_model.slice(0, 3);
      for (const m of top) {
        out.push(
          `              ${dim("·")} ${m.model.padEnd(28)} ${dim(formatCost(m.cost_usd))} ${dim(`(${m.sessions} session${m.sessions === 1 ? "" : "s"})`)}`,
        );
      }
    }
    out.push("");
  }
  return out.join("\n");
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}

function bold(s: string): string {
  if (!process.stdout.isTTY || process.env["NO_COLOR"]) return s;
  return `\x1b[1m${s}\x1b[0m`;
}

function dim(s: string): string {
  if (!process.stdout.isTTY || process.env["NO_COLOR"]) return s;
  return `\x1b[2m${s}\x1b[0m`;
}

// Cache TTL: max age of the OAuth-API cache before a render forces a
// synchronous re-fetch. Stale-while-revalidate kicks in earlier than
// this (see SWR_REVALIDATE_AFTER_MS in render.ts) — TTL is the
// hard ceiling, not the refresh cadence.
const CACHE_TTL_DEFAULT_MS = 30_000;
const CACHE_TTL_MIN_SEC = 1;
const CACHE_TTL_MAX_SEC = 300;

// Boolean env-var parser. Accepts: "1", "true", "TRUE", "yes" (case-
// insensitive) → true. Anything else, including unset, → false. Used
// for opt-in feature flags where the default-off matters more than
// catching every typo.
export function parseBooleanEnv(envValue: string | undefined): boolean {
  if (!envValue) return false;
  const normalised = envValue.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

export function resolveCacheTtlMs(envValue: string | undefined): number {
  if (envValue === undefined || envValue === "") return CACHE_TTL_DEFAULT_MS;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < CACHE_TTL_MIN_SEC || n > CACHE_TTL_MAX_SEC) {
    // Invalid input is silent — falling back to the default keeps the
    // hot path crash-free. `claudeline doctor` will surface the actual
    // TTL in use so users notice if their value was rejected.
    return CACHE_TTL_DEFAULT_MS;
  }
  return Math.round(n * 1000);
}

// Spawn a detached `claudeline _refresh` subprocess. Used by SWR — the
// main render returns immediately while this child fetches OAuth + writes
// the cache for the *next* render to see. We don't await; failure is
// silent because the next render will fall back to a synchronous fetch
// if needed.
function spawnDetachedRefresh(): void {
  try {
    const child = spawn("claudeline", ["_refresh"], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      // claudeline not on PATH (rare — usually a test environment or a
      // partial install). SWR is opportunistic so we don't surface this.
    });
    child.unref();
  } catch {
    // Same: never crash the parent render on spawn failure.
  }
}

// User-facing `claudeline refresh`. Forces a synchronous OAuth fetch
// and writes the cache. Useful when the user wants the freshest numbers
// before they look at the statusline (e.g. they think they're close to
// the rate-limit cap and want to verify).
async function runRefreshCmd(): Promise<number> {
  const uid = typeof process.getuid === "function" ? process.getuid() : "shared";
  const cachePath = join(tmpdir(), `claudeline-${uid}`, "usage-cache.json");
  const token = loadOAuthToken(defaultCredentialSources());
  if (!token) {
    process.stderr.write(
      "claudeline refresh: no OAuth token found. Run `claudeline doctor` to check credential sources.\n",
    );
    return 1;
  }
  const fetched = await fetchUsage(token);
  if (!fetched) {
    process.stderr.write(
      "claudeline refresh: OAuth API fetch failed. Check connectivity / `claudeline doctor`.\n",
    );
    return 1;
  }
  saveJsonCache(cachePath, { data: fetched.data, latencyMs: fetched.latencyMs });
  const preferApi = parseBooleanEnv(process.env["CLAUDELINE_PREFER_API"]);
  process.stdout.write(`Cache refreshed (${fetched.latencyMs} ms latency).\n`);
  if (!preferApi) {
    // Most users won't have CLAUDELINE_PREFER_API set, which means
    // recent Claude Code versions (which pass `rate_limits` in stdin)
    // will use that source instead of this cache. Surface the gap so
    // they know why their statusline didn't move after a refresh.
    process.stdout.write(
      "Note: when Claude Code passes rate_limits in stdin, the statusline\n" +
        "uses those values directly and bypasses this cache. To make refresh\n" +
        "drive what's shown, export CLAUDELINE_PREFER_API=1 and reload Claude Code.\n",
    );
  }
  return 0;
}

// Internal `_refresh` for SWR background spawns. Same logic as the
// user-facing version but silent on stdout/stderr — failures don't
// propagate because the spawning render has already moved on.
async function runInternalRefreshCmd(): Promise<number> {
  try {
    const uid =
      typeof process.getuid === "function" ? process.getuid() : "shared";
    const cachePath = join(tmpdir(), `claudeline-${uid}`, "usage-cache.json");
    const token = loadOAuthToken(defaultCredentialSources());
    if (!token) return 0;
    const fetched = await fetchUsage(token);
    if (!fetched) return 0;
    saveJsonCache(cachePath, {
      data: fetched.data,
      latencyMs: fetched.latencyMs,
    });
  } catch {
    // Silent: the next render does its own sync fetch if the cache is
    // still stale.
  }
  return 0;
}

function parseForce24(raw: string | undefined): boolean | undefined {
  if (raw === "1" || raw?.toLowerCase() === "true") return true;
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return undefined;
}

const MAX_STDIN_BYTES = 1 << 20; // 1 MiB — Claude Code payloads are ~kilobytes

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_STDIN_BYTES) return "";
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Only auto-run when this file is the program entrypoint (e.g. via the
// installed `claudeline` shim). Importing it from a test or another
// module loads the symbols (`adoptCachedUsage`, etc.) without firing
// the CLI side effects.
//
// `process.argv[1]` is the script path Node was invoked with. When the
// user runs `claudeline`, that path is a symlink (npm/bun installs a
// shim like `~/.bun/bin/claudeline → ../install/global/.../dist/cli.js`).
// Resolve the symlink before comparing — otherwise the shim never matches
// and `main()` silently does nothing.
const isEntrypoint = (() => {
  const argvScript = process.argv[1];
  if (!argvScript) return false;
  let resolved: string;
  try {
    resolved = realpathSync(argvScript);
  } catch {
    resolved = argvScript;
  }
  return resolved.endsWith("cli.js") || resolved.endsWith("cli.ts");
})();

if (isEntrypoint) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`claudeline: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
