import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { fetchUsage } from "./api.js";
import { loadJsonCache, saveJsonCache } from "./cache.js";
import { defaultCredentialSources, loadOAuthToken } from "./credentials.js";
import { getGitInfo } from "./git.js";
import { install, uninstall } from "./installer.js";
import { detectSkipPermissions, detectTimezone, readMacDefault } from "./platform.js";
import { renderStatusline } from "./render.js";
import {
  type StatuslineInput,
  statuslineInputSchema,
  type UsageApiResponse,
} from "./schemas.js";
import { defaultSettingsPath, readSettingsFile } from "./settings.js";
import { detect24Hour } from "./time.js";
import { VERSION } from "./version.js";
import * as z from "zod/mini";

const HELP = `claudeline ${VERSION} — cross-platform statusline for Claude Code

Usage:
  claudeline render                Read JSON from stdin and emit the statusline
  claudeline install               Wire claudeline as the statusLine in ~/.claude/settings.json
  claudeline uninstall             Remove claudeline from ~/.claude/settings.json
  claudeline --help                Show this help
  claudeline --version             Show version

Configuration sources:
  - .effort.level / .thinking.enabled from stdin (Claude Code runtime)
  - effortLevel / alwaysThinkingEnabled from ~/.claude/settings.json (fallback)
  - Rate limits: stdin first, otherwise OAuth API (cached 60s)

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

  if (cmd === "render" || cmd === undefined) {
    return await runRender();
  }

  process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
  return 2;
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

  const cachePath = join(tmpdir(), "claudeline", "usage-cache.json");
  const force24 = parseForce24(readMacDefault("AppleICUForce24HourTime"));
  const appleLocale = readMacDefault("AppleLocale");

  const detect24Input: Parameters<typeof detect24Hour>[0] = { env: process.env };
  if (typeof force24 === "boolean") detect24Input.force24h = force24;
  if (appleLocale) detect24Input.appleLocale = appleLocale;

  const use24h = detect24Hour(detect24Input);
  const tz = detectTimezone();

  const credentialSources = defaultCredentialSources();

  const out = await renderStatusline(parsed, {
    readSettings: () => readSettingsFile(),
    getGitInfo,
    detect24Hour: use24h,
    ...(tz ? { timeZone: tz } : {}),
    now: () => Date.now(),
    skipPermissions: detectSkipPermissions(),
    loadToken: () => loadOAuthToken(credentialSources),
    fetchUsage: async (token: string) => fetchUsage(token),
    cacheLoad: () => loadJsonCache<UsageApiResponse>(cachePath, 60_000),
    cacheSave: (data: UsageApiResponse) => saveJsonCache(cachePath, data),
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

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`claudeline: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
