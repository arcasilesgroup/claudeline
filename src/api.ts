import { type UsageApiResponse, usageApiSchema } from "./schemas.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USER_AGENT = "claudeline/0.1";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchUsageOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

export async function fetchUsage(
  token: string | undefined,
  options: FetchUsageOptions = {},
): Promise<UsageApiResponse | undefined> {
  if (!token || token.trim() === "") return undefined;

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
    return usageApiSchema.parse(json);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
