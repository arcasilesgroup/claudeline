import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type SessionLogPaths,
  type SessionRecord,
  appendSessionRecord,
  disableSessionLog,
  enableSessionLog,
  isSessionLogEnabled,
  readSessions,
  summarize,
} from "../src/sessionLog.js";

let scratch: string;
let paths: SessionLogPaths;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "claudeline-session-log-"));
  paths = { dir: scratch, file: join(scratch, "sessions.jsonl") };
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    v: 1,
    session_id: "default-session",
    started_at: "2026-04-28T08:00:00Z",
    logged_at: "2026-04-28T08:30:00Z",
    model_id: "claude-sonnet-4-6",
    model_display_name: "Claude Sonnet 4.6",
    cost_usd: 0.42,
    cwd: "/tmp/repo",
    git_branch: "main",
    exceeds_200k_tokens: false,
    fast_mode: false,
    ...overrides,
  };
}

describe("session log lifecycle", () => {
  test("isSessionLogEnabled is false before --enable", () => {
    expect(isSessionLogEnabled(paths)).toBe(false);
  });

  test("enable then disable round-trip", () => {
    enableSessionLog(paths);
    expect(isSessionLogEnabled(paths)).toBe(true);
    expect(existsSync(paths.file)).toBe(true);

    disableSessionLog(paths);
    expect(isSessionLogEnabled(paths)).toBe(false);
    expect(existsSync(paths.file)).toBe(false);
  });

  test("appendSessionRecord is a no-op when not enabled", () => {
    appendSessionRecord(paths, record());
    expect(existsSync(paths.file)).toBe(false);
  });

  test("appendSessionRecord writes when enabled", () => {
    enableSessionLog(paths);
    appendSessionRecord(paths, record());
    const sessions = readSessions(paths);
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.session_id).toBe("default-session");
  });
});

describe("readSessions", () => {
  test("dedups by session_id, last record wins", () => {
    enableSessionLog(paths);
    appendSessionRecord(paths, record({ session_id: "s1", cost_usd: 0.1, logged_at: "2026-04-28T08:00:00Z" }));
    appendSessionRecord(paths, record({ session_id: "s2", cost_usd: 0.2, logged_at: "2026-04-28T08:05:00Z" }));
    appendSessionRecord(paths, record({ session_id: "s1", cost_usd: 0.5, logged_at: "2026-04-28T08:10:00Z" }));

    const sessions = readSessions(paths);
    expect(sessions.length).toBe(2);
    const s1 = sessions.find((s) => s.session_id === "s1");
    const s2 = sessions.find((s) => s.session_id === "s2");
    expect(s1?.cost_usd).toBe(0.5); // Last write wins.
    expect(s2?.cost_usd).toBe(0.2);
  });

  test("skips malformed lines silently", () => {
    enableSessionLog(paths);
    appendSessionRecord(paths, record({ session_id: "s1" }));
    // Pollute the log with garbage. The reader must ignore it without
    // throwing — the file is a trust boundary.
    appendFile(paths.file, "not json\n");
    appendFile(paths.file, "{not: closed\n");
    appendSessionRecord(paths, record({ session_id: "s2" }));

    const sessions = readSessions(paths);
    expect(sessions.length).toBe(2);
    expect(sessions.map((s) => s.session_id).sort()).toEqual(["s1", "s2"]);
  });

  test("skips records missing required fields", () => {
    enableSessionLog(paths);
    appendFile(paths.file, JSON.stringify({ v: 1 }) + "\n");
    appendFile(paths.file, JSON.stringify({ v: 2, session_id: "x", logged_at: "now" }) + "\n");
    expect(readSessions(paths).length).toBe(0);
  });
});

describe("summarize", () => {
  test("rolls totals across all_time / today / week / month windows", () => {
    enableSessionLog(paths);
    // 1 record today, 2 in this week (1 today + 1 yesterday), 3 in
    // this month, 4 all-time. The "now" is fixed below.
    const now = Date.parse("2026-04-28T12:00:00Z");
    const today = "2026-04-28T10:00:00Z";
    const yesterday = "2026-04-27T10:00:00Z";
    const sameMonth = "2026-04-15T10:00:00Z";
    const lastMonth = "2026-03-15T10:00:00Z";

    appendSessionRecord(paths, record({ session_id: "today", logged_at: today, cost_usd: 1 }));
    appendSessionRecord(paths, record({ session_id: "yesterday", logged_at: yesterday, cost_usd: 2 }));
    appendSessionRecord(paths, record({ session_id: "this-month", logged_at: sameMonth, cost_usd: 4 }));
    appendSessionRecord(paths, record({ session_id: "last-month", logged_at: lastMonth, cost_usd: 8 }));

    const s = summarize(paths, { now });
    expect(s.total_sessions).toBe(4);
    expect(s.total_cost_usd).toBeCloseTo(15);

    expect(s.windows.today.sessions).toBe(1);
    expect(s.windows.today.total_cost_usd).toBeCloseTo(1);

    // ISO week (Mon-Sun): 2026-04-28 is Tuesday, week starts Mon 04-27.
    expect(s.windows.this_week.sessions).toBe(2);
    expect(s.windows.this_week.total_cost_usd).toBeCloseTo(3);

    expect(s.windows.this_month.sessions).toBe(3);
    expect(s.windows.this_month.total_cost_usd).toBeCloseTo(7);

    expect(s.windows.all_time.sessions).toBe(4);
    expect(s.windows.all_time.total_cost_usd).toBeCloseTo(15);
  });

  test("buckets cost by model display_name", () => {
    enableSessionLog(paths);
    const now = Date.parse("2026-04-28T12:00:00Z");
    appendSessionRecord(paths, record({ session_id: "a", model_display_name: "Sonnet", cost_usd: 1, logged_at: "2026-04-28T10:00:00Z" }));
    appendSessionRecord(paths, record({ session_id: "b", model_display_name: "Sonnet", cost_usd: 2, logged_at: "2026-04-28T11:00:00Z" }));
    appendSessionRecord(paths, record({ session_id: "c", model_display_name: "Opus", cost_usd: 5, logged_at: "2026-04-28T11:30:00Z" }));

    const today = summarize(paths, { now }).windows.today;
    expect(today.by_model.length).toBe(2);
    // Sorted by cost desc: Opus first.
    expect(today.by_model[0]?.model).toBe("Opus");
    expect(today.by_model[0]?.cost_usd).toBeCloseTo(5);
    expect(today.by_model[1]?.model).toBe("Sonnet");
    expect(today.by_model[1]?.sessions).toBe(2);
  });

  test("handles missing cost (null) by counting the session at $0", () => {
    enableSessionLog(paths);
    const now = Date.parse("2026-04-28T12:00:00Z");
    appendSessionRecord(paths, record({ session_id: "a", cost_usd: null, logged_at: "2026-04-28T10:00:00Z" }));
    appendSessionRecord(paths, record({ session_id: "b", cost_usd: 0.5, logged_at: "2026-04-28T11:00:00Z" }));
    const today = summarize(paths, { now }).windows.today;
    expect(today.sessions).toBe(2);
    expect(today.total_cost_usd).toBeCloseTo(0.5);
  });
});

// --- helper -------------------------------------------------------

import { appendFileSync } from "node:fs";
function appendFile(path: string, content: string): void {
  appendFileSync(path, content);
}
