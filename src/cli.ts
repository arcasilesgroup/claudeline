import { existsSync, lstatSync, realpathSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod/mini";
import { fetchUsage } from "./api.js";
import { adoptCachedUsage, loadJsonCache, saveJsonCache } from "./cache.js";
import { defaultCredentialSources, loadOAuthToken } from "./credentials.js";
import { type DoctorEnv, printReport, runDoctor } from "./doctor.js";
import { getGitInfo } from "./git.js";
import { glyphsFor, parseGlyphMode } from "./glyphs.js";
import { install, uninstall } from "./installer.js";
import { detectSkipPermissions, detectTimezone, readMacDefault } from "./platform.js";
import { type CachedUsage, renderStatusline } from "./render.js";
import {
  type StatuslineInput,
  statuslineInputSchema,
} from "./schemas.js";
import { defaultSettingsPath, readSettingsFile } from "./settings.js";
import { type RateState, loadState, saveState } from "./state.js";
import { detect24Hour } from "./time.js";
import { VERSION } from "./version.js";

const HELP = `claudeline ${VERSION} — cross-platform statusline for Claude Code

Usage:
  claudeline render                Read JSON from stdin and emit the statusline
  claudeline install               Wire claudeline as the statusLine in ~/.claude/settings.json
  claudeline uninstall             Remove claudeline from ~/.claude/settings.json
  claudeline doctor                Run diagnostics and print a pass/fail report
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
    return runDoctorCmd();
  }

  if (cmd === "render" || cmd === undefined) {
    return await runRender();
  }

  process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
  return 2;
}

// Run all diagnostic checks and print a pass/fail report. Always
// returns 0 — `doctor` is informational; the tool itself is functional
// even when a check warns. We surface failures via stdout, not exit
// code, so a CI-style `claudeline doctor || exit 1` would need to grep
// the output (intentional: doctor warnings are not test failures).
function runDoctorCmd(): number {
  const env = buildRealDoctorEnv();
  const report = runDoctor(env);
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
  };

  const bunVersion = process.versions["bun"];
  if (bunVersion) env.bunVersion = bunVersion;
  return env;
}

async function runRender(): Promise<number> {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write("Claude\n");
    return 0;
  }

  let parsed: StatuslineInput;
  try {
    parsed = z.parse(statuslineInputSchema, JSON.parse(raw));
  } catch {
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

  const out = await renderStatusline(parsed, {
    readSettings: () => readSettingsFile(),
    getGitInfo,
    detect24Hour: use24h,
    ...(tz ? { timeZone: tz } : {}),
    now: () => Date.now(),
    skipPermissions: detectSkipPermissions(),
    glyphs,
    loadToken: () => loadOAuthToken(credentialSources),
    fetchUsage: async (token: string) => fetchUsage(token),
    cacheLoad: () => adoptCachedUsage(loadJsonCache<unknown>(cachePath, 60_000)),
    cacheSave: (data: CachedUsage) => saveJsonCache(cachePath, data),
    loadState: (): RateState => loadState(statePath),
    saveState: (state: RateState) => saveState(statePath, state),
  });

  process.stdout.write(`${out}\n`);
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
