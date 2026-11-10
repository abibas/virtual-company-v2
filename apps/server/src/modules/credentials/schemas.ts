import { z } from '@hono/zod-openapi';
import { CREDENTIAL_LABEL, GATEWAY_PROVIDERS } from '@mwc/shared/credentials';
import { CredentialKind, CredentialStatus } from '@mwc/shared/enums';
import { AnthropicApiKey, GatewayHeaders, OpenAiApiKey, SetupToken } from './schemas/secrets.ts';

/**
 * The subscriptions API's shapes (`/api/me/subscriptions`). A response never carries a secret, not even to its
 * owner: only metadata. The pasted secrets' formats come from `schemas/secrets.ts`, the server's own shapes.
 */

export const SubscriptionParamsSchema = z.object({
  credentialId: z.string().openapi({
    param: { name: 'credentialId', in: 'path' },
    example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b',
  }),
});

const label = z
  .string()
  .trim()
  .min(CREDENTIAL_LABEL.min, 'A name is required')
  .max(CREDENTIAL_LABEL.max, `A name is at most ${CREDENTIAL_LABEL.max} characters`)
  .openapi({ example: 'Max at home' });

/** Non-secret details of the account: plan, organization, scopes, a gateway's base URL and provider. */
export const AccountMetaSchema = z
  .record(z.string(), z.unknown())
  .openapi('SubscriptionAccount', { example: { baseUrl: 'http://localhost:8300', provider: 'anthropic' } });

/** A subscription as the API shows it: what it is, whose account, its state. Never its secret. */
export const SubscriptionSchema = z
  .object({
    id: z.string(),
    kind: CredentialKind,
    label: z.string().openapi({ example: 'Max at home' }),
    accountEmail: z.string().nullable().openapi({ example: 'ihor@example.com' }),
    accountMeta: AccountMetaSchema,
    status: CredentialStatus,
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
    lastUsedAt: z
      .string()
      .nullable()
      .openapi({ format: 'date-time', description: 'The last time the server opened the secret' }),
  })
  .openapi('Subscription');

export const SubscriptionListSchema = z
  .object({ subscriptions: z.array(SubscriptionSchema) })
  .openapi('SubscriptionList');

/** A gateway's address: http or https. */
const GatewayUrl = z
  .url({ protocol: /^https?$/, error: 'A gateway address is an http or https URL' })
  .max(2048)
  .openapi({ example: 'http://localhost:8300' });

/**
 * Whose API a gateway speaks: `anthropic` for Claude Code, `openai` for Codex (`anthropic` when left out, as gateways
 * were before they had one).
 */
const GatewayProviderSchema = z
  .enum(GATEWAY_PROVIDERS)
  .default('anthropic')
  .openapi({ description: '`anthropic` for Claude Code profiles, `openai` for Codex (OpenAI) profiles' });

/**
 * A pasted subscription: its kind, a name and its secret (a setup-token, an API key, or a gateway's provider, address
 * and headers). The two logins are added by signing in, not here.
 */
export const AddSubscriptionSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('claude_setup_token'), label, token: SetupToken }),
    z.object({ kind: z.literal('anthropic_api_key'), label, apiKey: AnthropicApiKey }),
    z.object({ kind: z.literal('openai_api_key'), label, apiKey: OpenAiApiKey }),
    z.object({
      kind: z.literal('gateway'),
      label,
      provider: GatewayProviderSchema,
      baseUrl: GatewayUrl,
      headers: GatewayHeaders,
    }),
  ])
  .openapi('AddSubscription');

export const RenameSubscriptionSchema = z.object({ label }).openapi('RenameSubscription');

export type SubscriptionView = z.infer<typeof SubscriptionSchema>;
export type AccountMeta = z.infer<typeof AccountMetaSchema>;
export type AddSubscription = z.infer<typeof AddSubscriptionSchema>;
