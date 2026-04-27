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
    now: () => new Date("2026-04-26T20:00:00Z").getTime(),
    skipPermissions: false,
    glyphs: glyphsFor("emoji"),
    fetchUsage: async () => undefined,
    loadToken: () => undefined,
    cacheLoad: () => undefined,
    cacheSave: () => {},
    loadState: () => stateStore,
    saveState: (s) => {
      stateStore = s;
    },
    ...overrides,
  };
}

export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
