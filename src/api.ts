import * as z from "zod/mini";
import { type UsageApiResponse, usageApiSchema } from "./schemas.js";
import { VERSION } from "./version.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USER_AGENT = `claudeline/${VERSION}`;
const DEFAULT_TIMEOUT_MS = 1500;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchUsageOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

export interface FetchUsageResult {
  data: UsageApiResponse;
  latencyMs: number;
}

export async function fetchUsage(
  token: string | undefined,
  options: FetchUsageOptions = {},
): Promise<FetchUsageResult | undefined> {
  if (!token || token.trim() === "") return undefined;

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchFn(USAGE_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const json = await response.json();
    const latencyMs = Date.now() - startedAt;
    return { data: z.parse(usageApiSchema, json), latencyMs };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
