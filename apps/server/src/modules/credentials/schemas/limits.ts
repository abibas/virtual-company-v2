import { z } from '@hono/zod-openapi';
import { CredentialKind } from '@mwc/shared/enums';

/**
 * The limits API's shapes (`GET /api/me/subscriptions/limits`, S3.3): each of the caller's subscriptions with its live
 * 5-hour and weekly windows as the provider reports them, where they came from, and the last check's refusal in plain
 * words. Never a token or a provider's answer.
 */

/** A limit window: the 5-hour one, Claude's weekly ones (all models, Opus, Sonnet), or OpenAI's weekly one. */
export const LimitWindowId = z.enum([
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'weekly',
]);
export type LimitWindowId = z.infer<typeof LimitWindowId>;

/**
 * Where a subscription's limits come from: the provider's usage API (a Claude or OpenAI login), the rate-limit headers
 * of a one-token Messages request (a setup-token), or nowhere (API keys and gateways have no plan limits).
 */
export const UsageSource = z.enum(['usage_api', 'message_headers', 'none']);
export type UsageSource = z.infer<typeof UsageSource>;

export const LimitWindowSchema = z
  .object({
    id: LimitWindowId,
    label: z.string().openapi({ example: '5-hour limit' }),
    usedPercent: z.number().min(0).max(100).openapi({ example: 42.5 }),
    resetsAt: z.string().nullable().openapi({
      format: 'date-time',
      description: 'When the window resets; null when the provider did not say',
    }),
    reached: z.boolean().openapi({ description: 'The provider refuses requests until the window resets' }),
  })
  .openapi('LimitWindow');

export const UsageErrorSchema = z
  .object({
    code: z.string().openapi({ example: 'rate_limited' }),
    message: z.string().openapi({ example: 'The provider rate limited the usage check. Try again later.' }),
  })
  .openapi('UsageError');

export const SubscriptionLimitsSchema = z
  .object({
    credentialId: z.string(),
    kind: CredentialKind,
    label: z.string().openapi({ example: 'Max at home' }),
    accountEmail: z.string().nullable().openapi({ example: 'ihor@example.com' }),
    source: UsageSource,
    checkedAt: z.string().nullable().openapi({
      format: 'date-time',
      description: 'The last check; null when it was never checked (or has no limits)',
    }),
    windows: z.array(LimitWindowSchema),
    error: UsageErrorSchema.nullable().openapi({
      description: "The last check's refusal; null when it worked",
    }),
    stale: z
      .boolean()
      .openapi({ description: 'The windows are from an earlier check, kept because the last one failed' }),
  })
  .openapi('SubscriptionLimits');

export const SubscriptionLimitsListSchema = z
  .object({ limits: z.array(SubscriptionLimitsSchema) })
  .openapi('SubscriptionLimitsList');

export const LimitsQuerySchema = z.object({
  refresh: z
    .enum(['0', '1', 'false', 'true'])
    .optional()
    .openapi({ param: { name: 'refresh', in: 'query' }, example: '1' }),
});

export type LimitWindow = z.infer<typeof LimitWindowSchema>;
export type UsageError = z.infer<typeof UsageErrorSchema>;
export type SubscriptionLimits = z.infer<typeof SubscriptionLimitsSchema>;
