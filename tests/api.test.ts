import { describe, expect, test } from "bun:test";
import { fetchUsage } from "../src/api.js";

describe("fetchUsage", () => {
  test("returns parsed usage and latency on 200 OK", async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          five_hour: { utilization: 12.4, resets_at: "2026-04-26T22:30:00Z" },
          seven_day: { utilization: 38, resets_at: "2026-05-01T22:00:00Z" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await fetchUsage("tok", { fetchFn: fakeFetch });
    expect(result).toBeDefined();
    expect(result?.data.five_hour?.utilization).toBe(12.4);
    expect(typeof result?.latencyMs).toBe("number");
    expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("returns undefined on non-2xx", async () => {
    const fakeFetch = async () => new Response("nope", { status: 500 });
    expect(await fetchUsage("tok", { fetchFn: fakeFetch })).toBeUndefined();
  });

  test("returns undefined on bogus body", async () => {
    const fakeFetch = async () => new Response("not-json", { status: 200 });
    expect(await fetchUsage("tok", { fetchFn: fakeFetch })).toBeUndefined();
  });

  test("returns undefined when token missing", async () => {
    expect(await fetchUsage(undefined, {})).toBeUndefined();
    expect(await fetchUsage("", {})).toBeUndefined();
  });

  test("aborts on timeout", async () => {
    const fakeFetch = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) signal.addEventListener("abort", () => reject(signal.reason));
      });
    const start = Date.now();
    const result = await fetchUsage("tok", {
      fetchFn: fakeFetch,
      timeoutMs: 50,
    });
    expect(result).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(500);
  });

  test("measures latency for slow responses", async () => {
    const fakeFetch = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const result = await fetchUsage("tok", { fetchFn: fakeFetch });
    expect(result?.latencyMs).toBeGreaterThanOrEqual(20);
  });
});
