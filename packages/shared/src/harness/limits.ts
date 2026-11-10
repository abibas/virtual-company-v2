import { z } from 'zod';
import { protocolObject } from '../runner-protocol/common.ts';

/**
 * A subscription's usage limits as the harness last saw them (docs/harness.md, "Codex's context reading"): Codex
 * writes them with each reading in its session file (`rate_limits`). `primary` and `secondary` are Codex's two windows,
 * on a ChatGPT plan usually the 5-hour and the weekly one (`windowMinutes` says which). Optional data: nothing shows it
 * yet.
 */

/** The longest plan name (`plus`, `pro`, `team`). */
export const PLAN_TYPE_MAX = 50;

/** One limit window: how much of it is used, how long it is, and when it resets. */
export const RateLimitWindow = protocolObject({
  /** 0–100. */
  usedPercent: z.number().min(0).max(100),
  windowMinutes: z.int().positive().optional(),
  resetsAt: z.iso.datetime().optional(),
});
export type RateLimitWindow = z.infer<typeof RateLimitWindow>;

export const RateLimits = protocolObject({
  primary: RateLimitWindow.optional(),
  secondary: RateLimitWindow.optional(),
  planType: z.string().min(1).max(PLAN_TYPE_MAX).optional(),
});
export type RateLimits = z.infer<typeof RateLimits>;
