import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Session-history opt-in store. Per-render appends one JSON line; the
// `claudeline summary` reader dedups by session_id (last record wins)
// to recover the final state of each session.
//
// Storage location: `~/.claudeline/sessions.jsonl`.
//
// Opt-in model: the file's existence is the enable flag. `claudeline
// summary --enable` creates the dir + empty file; `--disable` removes
// it. Render only writes if the file is already present, which keeps
// the hot path zero-cost for users who never opt in.
//
// All data stays local. No network egress, no telemetry. Run
// `claudeline summary --disable` to delete.

export interface SessionRecord {
  v: 1;
  session_id: string;
  started_at: string | null;
  logged_at: string;
  model_id: string | null;
  model_display_name: string | null;
  cost_usd: number | null;
  cwd: string | null;
  git_branch: string | null;
  exceeds_200k_tokens: boolean;
  fast_mode: boolean;
}

export interface SessionLogPaths {
  dir: string;
  file: string;
}

export function defaultSessionLogPaths(): SessionLogPaths {
  const dir = join(homedir(), ".claudeline");
  return { dir, file: join(dir, "sessions.jsonl") };
}

export function isSessionLogEnabled(paths: SessionLogPaths): boolean {
  return existsSync(paths.file);
}

export function enableSessionLog(paths: SessionLogPaths): void {
  if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  if (!existsSync(paths.file)) {
    // Touch with restrictive perms so cwd/git_branch contents stay
    // readable only to the owner on shared hosts.
    const fd = openSync(paths.file, "a", 0o600);
    closeSync(fd);
  }
}

export function disableSessionLog(paths: SessionLogPaths): void {
  if (existsSync(paths.file)) rmSync(paths.file, { force: true });
}

// Append one record to the log. No-op if logging isn't enabled (file
// doesn't exist). Uses synchronous append to avoid the orphaned-write
// risk a fire-and-forget async would carry when the process exits
// immediately after render. Single appendFileSync of ~200 bytes is
// negligible (sub-ms on local SSDs).
export function appendSessionRecord(
  paths: SessionLogPaths,
  record: SessionRecord,
): void {
  if (!isSessionLogEnabled(paths)) return;
  try {
    appendFileSync(paths.file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch {
    // Logging is best-effort. If the disk is full or perms are wrong,
    // we drop the record rather than crashing the render. The user can
    // re-enable and try again.
  }
}

// Read the full log, dedup by session_id keeping the last record for
// each session. Malformed lines are silently skipped — the file is a
// trust boundary (could be hand-edited or partially-written).
export function readSessions(paths: SessionLogPaths): SessionRecord[] {
  if (!existsSync(paths.file)) return [];
  let raw: string;
  try {
    raw = readFileSync(paths.file, "utf-8");
  } catch {
    return [];
  }
  const byId = new Map<string, SessionRecord>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<SessionRecord>;
      if (
        parsed.v === 1 &&
        typeof parsed.session_id === "string" &&
        typeof parsed.logged_at === "string"
      ) {
        // Cast is safe after the field-shape gate above; we treat the
        // fields the reader cares about as nullable in the type.
        byId.set(parsed.session_id, parsed as SessionRecord);
      }
    } catch {
      // Skip malformed line.
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.logged_at.localeCompare(b.logged_at),
  );
}

export interface SummaryWindow {
  label: string;
  sessions: number;
  total_cost_usd: number;
  by_model: Array<{ model: string; sessions: number; cost_usd: number }>;
}

export interface SummaryResult {
  total_sessions: number;
  total_cost_usd: number;
  windows: {
    today: SummaryWindow;
    this_week: SummaryWindow;
    this_month: SummaryWindow;
    all_time: SummaryWindow;
  };
  log_file: string;
}

export interface SummarizeOptions {
  // Pass an explicit `now` so tests are deterministic. Defaults to
  // `Date.now()` for production callers.
  now?: number;
}

export function summarize(
  paths: SessionLogPaths,
  options: SummarizeOptions = {},
): SummaryResult {
  const now = options.now ?? Date.now();
  const records = readSessions(paths);

  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  return {
    total_sessions: records.length,
    total_cost_usd: sumCost(records),
    windows: {
      today: window("Today", records, todayStart),
      this_week: window("This week", records, weekStart),
      this_month: window("This month", records, monthStart),
      all_time: window("All time", records, 0),
    },
    log_file: paths.file,
  };
}

function window(label: string, records: SessionRecord[], sinceMs: number): SummaryWindow {
  const filtered = records.filter((r) => {
    const t = Date.parse(r.logged_at);
    return Number.isFinite(t) && t >= sinceMs;
  });
  const byModel = new Map<string, { sessions: number; cost: number }>();
  for (const r of filtered) {
    const key = r.model_display_name ?? r.model_id ?? "(unknown)";
    const acc = byModel.get(key) ?? { sessions: 0, cost: 0 };
    acc.sessions += 1;
    acc.cost += r.cost_usd ?? 0;
    byModel.set(key, acc);
  }
  return {
    label,
    sessions: filtered.length,
    total_cost_usd: sumCost(filtered),
    by_model: Array.from(byModel.entries())
      .map(([model, v]) => ({
        model,
        sessions: v.sessions,
        cost_usd: round2(v.cost),
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd),
  };
}

function sumCost(records: SessionRecord[]): number {
  return round2(records.reduce((acc, r) => acc + (r.cost_usd ?? 0), 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(nowMs: number): number {
  // ISO week: Monday is day 1. Using local time so "this week" matches
  // the user's calendar intuition.
  const d = new Date(nowMs);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(nowMs: number): number {
  const d = new Date(nowMs);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

