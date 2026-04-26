import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist", "cli.js");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
  version: string;
};

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function run(args: string[], stdin = "") {
  return spawnSync("node", [dist, ...args], {
    input: stdin,
    encoding: "utf-8",
  });
}

describe("cli", () => {
  test("dist/cli.js exists (run `bun run build` first)", () => {
    expect(existsSync(dist)).toBe(true);
  });

  test("--version matches package.json", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  test("-v shorthand", () => {
    const r = run(["-v"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  test("--help prints usage and exits 0", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("claudeline render");
  });

  test("unknown command exits 2", () => {
    const r = run(["bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  test("render with empty stdin prints 'Claude'", () => {
    const r = run(["render"], "");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Claude");
  });

  test("render with malformed JSON falls back to 'Claude'", () => {
    const r = run(["render"], "not json");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Claude");
  });

  test("render with valid JSON emits the model name", () => {
    const r = run(
      ["render"],
      '{"model":{"display_name":"Opus 4.7"},"cwd":"/tmp"}',
    );
    expect(r.status).toBe(0);
    expect(stripAnsi(r.stdout)).toContain("Opus 4.7");
    expect(stripAnsi(r.stdout)).toContain("tmp");
  });

  test("render tolerates null fields without collapsing", () => {
    const r = run(
      ["render"],
      '{"model":{"display_name":"Opus"},"effort":{"level":null},"thinking":{"enabled":null},"cwd":"/tmp"}',
    );
    expect(r.status).toBe(0);
    expect(stripAnsi(r.stdout)).toContain("Opus");
    expect(stripAnsi(r.stdout)).not.toBe("Claude");
  });

  test("render renders effort high glyph", () => {
    const r = run(
      ["render"],
      '{"model":{"display_name":"X"},"effort":{"level":"high"},"cwd":"/tmp"}',
    );
    expect(stripAnsi(r.stdout)).toContain("● high");
  });

  test("render with stdin > 1 MiB falls back silently", () => {
    const big = "x".repeat(1100000);
    const r = run(["render"], big);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Claude");
  });
});
