import { z } from "zod";

const tokenUsage = z
  .object({
    input_tokens: z.number().int().nonnegative().default(0),
    cache_creation_input_tokens: z.number().int().nonnegative().default(0),
    cache_read_input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative().default(0),
  })
  .partial();

const rateLimitWindow = z.object({
  used_percentage: z.number().nonnegative().optional(),
  resets_at: z.union([z.string(), z.number()]).optional(),
});

export const statuslineInputSchema = z
  .object({
    model: z
      .object({
        id: z.string().optional(),
        display_name: z.string().optional(),
      })
      .partial()
      .optional(),
    cwd: z.string().optional(),
    workspace: z
      .object({
        current_dir: z.string().optional(),
        project_dir: z.string().optional(),
      })
      .partial()
      .optional(),
    session: z
      .object({
        id: z.string().optional(),
        start_time: z.string().optional(),
      })
      .partial()
      .optional(),
    context_window: z
      .object({
        context_window_size: z.number().int().nonnegative().optional(),
        used_percentage: z.number().nonnegative().optional(),
        current_usage: tokenUsage.optional(),
      })
      .partial()
      .optional(),
    effort: z
      .object({
        level: z.string().optional(),
      })
      .partial()
      .optional(),
    thinking: z
      .object({
        enabled: z.boolean().optional(),
      })
      .partial()
      .optional(),
    rate_limits: z
      .object({
        five_hour: rateLimitWindow.optional(),
        seven_day: rateLimitWindow.optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export type StatuslineInput = z.infer<typeof statuslineInputSchema>;

export const usageApiSchema = z
  .object({
    five_hour: z
      .object({
        utilization: z.number().nonnegative().optional(),
        resets_at: z.string().optional(),
      })
      .partial()
      .optional(),
    seven_day: z
      .object({
        utilization: z.number().nonnegative().optional(),
        resets_at: z.string().optional(),
      })
      .partial()
      .optional(),
    extra_usage: z
      .object({
        is_enabled: z.boolean().optional(),
        utilization: z.number().nonnegative().optional(),
        used_credits: z.number().nonnegative().optional(),
        monthly_limit: z.number().nonnegative().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export type UsageApiResponse = z.infer<typeof usageApiSchema>;

export const settingsSchema = z
  .object({
    effortLevel: z.string().optional(),
    alwaysThinkingEnabled: z.boolean().optional(),
    statusLine: z
      .object({
        type: z.string(),
        command: z.string(),
      })
      .optional(),
  })
  .passthrough();

export type Settings = z.infer<typeof settingsSchema>;

export const credentialsFileSchema = z
  .object({
    claudeAiOauth: z
      .object({
        accessToken: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();
