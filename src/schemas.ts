import * as z from "zod/mini";

// Optional fields tolerate null too, since JSON producers commonly
// encode "absent" as null. Without this, a single `null` collapses
// the whole stdin parse and the statusline falls back to "Claude".
// Consumers downstream already use `?? fallback`, which handles both
// `null` and `undefined` identically.
const nullish = <T extends z.ZodMiniType>(schema: T) =>
  z.optional(z.nullable(schema));

const tokenUsage = z.object({
  input_tokens: nullish(z.int().check(z.nonnegative())),
  cache_creation_input_tokens: nullish(z.int().check(z.nonnegative())),
  cache_read_input_tokens: nullish(z.int().check(z.nonnegative())),
  output_tokens: nullish(z.int().check(z.nonnegative())),
});

const rateLimitWindow = z.object({
  used_percentage: nullish(z.number().check(z.nonnegative())),
  resets_at: nullish(z.union([z.string(), z.number()])),
});

export const statuslineInputSchema = z.looseObject({
  model: nullish(
    z.object({
      id: nullish(z.string()),
      display_name: nullish(z.string()),
    }),
  ),
  cwd: nullish(z.string()),
  workspace: nullish(
    z.object({
      current_dir: nullish(z.string()),
      project_dir: nullish(z.string()),
    }),
  ),
  session: nullish(
    z.object({
      id: nullish(z.string()),
      start_time: nullish(z.string()),
    }),
  ),
  context_window: nullish(
    z.object({
      context_window_size: nullish(z.int().check(z.nonnegative())),
      used_percentage: nullish(z.number().check(z.nonnegative())),
      current_usage: nullish(tokenUsage),
    }),
  ),
  effort: nullish(
    z.object({
      level: nullish(z.string()),
    }),
  ),
  thinking: nullish(
    z.object({
      enabled: nullish(z.boolean()),
    }),
  ),
  rate_limits: nullish(
    z.object({
      five_hour: nullish(rateLimitWindow),
      seven_day: nullish(rateLimitWindow),
    }),
  ),
});

export type StatuslineInput = z.infer<typeof statuslineInputSchema>;

export const usageApiSchema = z.looseObject({
  five_hour: nullish(
    z.object({
      utilization: nullish(z.number().check(z.nonnegative())),
      resets_at: nullish(z.string()),
    }),
  ),
  seven_day: nullish(
    z.object({
      utilization: nullish(z.number().check(z.nonnegative())),
      resets_at: nullish(z.string()),
    }),
  ),
  extra_usage: nullish(
    z.object({
      is_enabled: nullish(z.boolean()),
      utilization: nullish(z.number().check(z.nonnegative())),
      used_credits: nullish(z.number().check(z.nonnegative())),
      monthly_limit: nullish(z.number().check(z.nonnegative())),
    }),
  ),
});

export type UsageApiResponse = z.infer<typeof usageApiSchema>;

export const settingsSchema = z.looseObject({
  effortLevel: nullish(z.string()),
  alwaysThinkingEnabled: nullish(z.boolean()),
  statusLine: nullish(
    z.object({
      type: z.string(),
      command: z.string(),
    }),
  ),
});

export type Settings = z.infer<typeof settingsSchema>;

export const credentialsFileSchema = z.looseObject({
  claudeAiOauth: nullish(
    z.object({
      accessToken: nullish(z.string()),
    }),
  ),
});
