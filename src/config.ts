import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// User-facing persistent config. Mirrors the env vars (`CLAUDELINE_*`)
// but lives in `~/.claudeline/config.json` so users don't have to bet
// on env-var propagation through their shell rc and Claude Code's
// statusline subprocess. Env vars still win at read time — they're the
// override, the config file is the default.
//
// Why a file instead of env-only:
//  - Subprocess env propagation is a frequent footgun. Users edit zshrc,
//    forget to reload, or Claude Code is already running with the
//    pre-edit env. The config file just works.
//  - Settings are durable across machines via dotfiles managers.
//  - We can extend this without growing the env-var surface.

export interface ClaudelineConfig {
  // When true, render ignores `input.rate_limits` from stdin and reads
  // from the OAuth-API cache instead — making `claudeline refresh`
  // actually drive what's shown.
  preferApi?: boolean;
  // Cache TTL in seconds (clamped to [1, 300] at read time). Default 30.
  cacheTtlSec?: number;
}

export interface ConfigPaths {
  dir: string;
  file: string;
}

export function defaultConfigPaths(): ConfigPaths {
  const dir = join(homedir(), ".claudeline");
  return { dir, file: join(dir, "config.json") };
}

// Mutable view used by the get/set/unset commands. Always returns an
// object even when the file is missing — callers can write in place.
export function readConfig(paths: ConfigPaths): ClaudelineConfig {
  if (!existsSync(paths.file)) return {};
  try {
    const raw = readFileSync(paths.file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ClaudelineConfig>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ClaudelineConfig = {};
    if (typeof parsed.preferApi === "boolean") out.preferApi = parsed.preferApi;
    if (typeof parsed.cacheTtlSec === "number" && Number.isFinite(parsed.cacheTtlSec)) {
      out.cacheTtlSec = parsed.cacheTtlSec;
    }
    return out;
  } catch {
    // Trust boundary: a hand-edited file with bad JSON falls back to
    // empty rather than crashing render. The user can re-set values.
    return {};
  }
}

export function writeConfig(paths: ConfigPaths, config: ClaudelineConfig): void {
  if (!existsSync(paths.dir)) {
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  }
  // Preserve the file even if it exists; we just overwrite atomically.
  writeFileSync(paths.file, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function ensureConfigFile(paths: ConfigPaths): void {
  // `recursive` is idempotent, so no `existsSync` guard is needed.
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  // Atomic create-if-absent on a file descriptor. `wx` is
  // `O_CREAT | O_EXCL | O_WRONLY` — the kernel creates the file or fails
  // with `EEXIST`, collapsing the check-then-write TOCTOU window
  // (CWE-367) into one syscall. Writes go through the fd, never the
  // path, so an attacker cannot swap the target between create and write.
  try {
    const fd = openSync(paths.file, "wx", 0o600);
    try {
      // Initialise with `{}` so editors don't see "0 bytes" weirdness.
      writeFileSync(fd, "{}\n");
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    // Already initialised — leave the existing file untouched.
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

export function deleteConfig(paths: ConfigPaths): void {
  if (existsSync(paths.file)) rmSync(paths.file, { force: true });
}

// Precedence resolver: env > config > default. The "source" tag is
// surfaced in `claudeline doctor` so users immediately see *why* a
// value is what it is.

export type Source = "env" | "config" | "default";

export interface ResolvedSetting<T> {
  value: T;
  source: Source;
}

export function resolveBoolean(opts: {
  envValue: string | undefined;
  configValue: boolean | undefined;
  defaultValue: boolean;
}): ResolvedSetting<boolean> {
  if (opts.envValue !== undefined && opts.envValue !== "") {
    const v = opts.envValue.trim().toLowerCase();
    return {
      value: v === "1" || v === "true" || v === "yes",
      source: "env",
    };
  }
  if (opts.configValue !== undefined) {
    return { value: opts.configValue, source: "config" };
  }
  return { value: opts.defaultValue, source: "default" };
}

export function resolveSeconds(opts: {
  envValue: string | undefined;
  configValue: number | undefined;
  defaultValueSec: number;
  minSec: number;
  maxSec: number;
}): ResolvedSetting<number> {
  // Env first; only honour if it parses inside the clamp window.
  if (opts.envValue !== undefined && opts.envValue !== "") {
    const n = Number(opts.envValue);
    if (Number.isFinite(n) && n >= opts.minSec && n <= opts.maxSec) {
      return { value: n, source: "env" };
    }
    // Fall through to config / default if env was set but invalid.
  }
  if (
    opts.configValue !== undefined &&
    Number.isFinite(opts.configValue) &&
    opts.configValue >= opts.minSec &&
    opts.configValue <= opts.maxSec
  ) {
    return { value: opts.configValue, source: "config" };
  }
  return { value: opts.defaultValueSec, source: "default" };
}
