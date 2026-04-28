import { glyphsFor } from "../src/glyphs.js";
import type { RenderDeps } from "../src/render.js";
import type { RateState } from "../src/state.js";

// Shared mock for `RenderDeps`. Most render-path tests need the same
// neutral defaults (no token, no fetch, no settings, in-memory state);
// previously every file inlined a near-identical builder, which drifted
// silently when the `RenderDeps` interface evolved. One source of truth
// keeps the test surface coherent.
export function mockDeps(overrides: Partial<RenderDeps> = {}): RenderDeps {
  let stateStore: RateState = {};
  return {
    readSettings: () => ({}),
    getGitInfo: () => ({ branch: undefined, dirty: false, worktree: false }),
    detect24Hour: true,
    timeZone: "Europe/Madrid",
    // Fixed clock: 2026-04-26T20:00:00Z (= 1777233600000 ms).
    // Chosen so the two real-world fixture `resets_at` values
    // (1777296000, 1777300000) sit ~17h in the future — the renderer
    // exercises the "still counting down" branch rather than the
    // "just reset" branch. If a future fixture-driven test wants
    // post-reset behaviour, override `now` per call site instead of
    // changing this default.
    now: () => new Date("2026-04-26T20:00:00Z").getTime(),
    skipPermissions: false,
    glyphs: glyphsFor("emoji"),
    fetchUsage: async () => undefined,
    loadToken: () => undefined,
    cacheLoad: () => undefined, // SWR-aware: returns { cache, ageMs } | undefined
    cacheSave: () => {},
    loadState: () => stateStore,
    saveState: (s) => {
      stateStore = s;
    },
    ...overrides,
  };
}

export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
