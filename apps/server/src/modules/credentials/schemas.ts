import { z } from '@hono/zod-openapi';
import {
  CREDENTIAL_LABEL,
  DEFAULT_GATEWAY_PATHS,
  GATEWAY_HEADERS,
  GATEWAY_PATH_MAX,
} from '@mwc/shared/credentials';
import { CredentialKind, CredentialStatus, ToolCheckError } from '@mwc/shared/enums';
import {
  AnthropicApiKey,
  GatewayHeaderName,
  GatewayHeaders,
  GatewayHeaderValue,
  OpenAiApiKey,
  SetupToken,
} from './schemas/secrets.ts';

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

/** Non-secret details of the account: plan, organization, scopes, a gateway's address and its own paths. */
export const AccountMetaSchema = z
  .record(z.string(), z.unknown())
  .openapi('SubscriptionAccount', { example: { baseUrl: 'http://127.0.0.1:8300' } });

/** A gateway's header as the API shows it: its name and a preview of its value, never the value. */
export const GatewayHeaderPreviewSchema = z
  .object({
    name: z.string().openapi({ example: 'x-api-key' }),
    preview: z.string().openapi({ example: 'agk-NTE5••••MHx8' }),
  })
  .openapi('GatewayHeaderPreview');

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
    checkedAt: z.string().nullable().openapi({
      format: 'date-time',
      description: "A tool sign-in's last check with its provider; null for the AI kinds",
    }),
    checkError: z
      .object({ code: ToolCheckError, message: z.string() })
      .nullable()
      .openapi({ description: 'Why that check did not finish, in plain words; null when it worked' }),
    headers: z
      .array(GatewayHeaderPreviewSchema)
      .nullable()
      .openapi({
        description:
          "A gateway's headers in order, each its name and a preview of its value (16 characters or more: the first 8 " +
          'and the last 4; 8 to 15: the first 2 and the last 2; fewer: none; a scheme word such as Bearer kept); null ' +
          'for the other kinds',
      }),
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

/** A path under a gateway's address: empty (or `/`) for the address itself, else starting with `/`. */
const GatewayPath = z
  .string()
  .trim()
  .max(GATEWAY_PATH_MAX, `A path is at most ${GATEWAY_PATH_MAX} characters`)
  .regex(/^(\/[^\s?#]*)?$/, 'A path starts with / and has no spaces, ? or #');

/**
 * A gateway's own paths, one per way a turn reaches it; each left out takes its default (Claude Code `""`, Codex with
 * ChatGPT `/backend-api/codex`, Codex with an API key `/v1`).
 */
export const GatewayPathsSchema = z
  .strictObject({
    claude: GatewayPath.optional(),
    codexChatgpt: GatewayPath.optional(),
    codexApiKey: GatewayPath.optional(),
  })
  .openapi('GatewayPaths', {
    description: `Each CLI's path under the gateway's address; defaults ${JSON.stringify(DEFAULT_GATEWAY_PATHS)}`,
    example: { codexChatgpt: '/backend-api/codex' },
  });

/**
 * A pasted subscription: its kind, a name and its secret (a setup-token, an API key, or a gateway's address, its
 * optional paths and its headers). A gateway serves Claude Code and Codex alike. The two logins are added by signing
 * in, not here.
 */
export const AddSubscriptionSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('claude_setup_token'), label, token: SetupToken }),
    z.object({ kind: z.literal('anthropic_api_key'), label, apiKey: AnthropicApiKey }),
    z.object({ kind: z.literal('openai_api_key'), label, apiKey: OpenAiApiKey }),
    z.object({
      kind: z.literal('gateway'),
      label,
      baseUrl: GatewayUrl,
      paths: GatewayPathsSchema.optional(),
      headers: GatewayHeaders,
    }),
  ])
  .openapi('AddSubscription');

/** One header a gateway keeps after an edit (`editHeaders` of `rules/gateway-headers.ts`). */
export const GatewayHeaderEditSchema = z
  .strictObject({
    name: GatewayHeaderName,
    from: GatewayHeaderName.optional().openapi({
      description:
        'The stored header it continues under a new name (a rename); left out, the one of its own name',
    }),
    value: GatewayHeaderValue.optional().openapi({
      description: 'A new value; left out, the stored value stays (required for a new header)',
    }),
  })
  .openapi('GatewayHeaderEdit', { example: { name: 'x-api-key', from: 'x-key' } });

/** The headers a gateway keeps, in order: names that differ (in any case), at most 20. */
const GatewayHeaderEdits = z
  .array(GatewayHeaderEditSchema)
  .max(GATEWAY_HEADERS.max, `A gateway takes at most ${GATEWAY_HEADERS.max} headers`)
  .refine(
    (edits) => new Set(edits.map((edit) => edit.name.toLowerCase())).size === edits.length,
    'Each header has its own name',
  );

/**
 * A change of a subscription: its name, and for a gateway its address, paths (given paths replace its own; `{}` goes
 * back to the defaults) and headers (the whole list it keeps; a stored header left out is removed). At least one of them.
 */
export const UpdateSubscriptionSchema = z
  .object({
    label: label.optional(),
    baseUrl: GatewayUrl.optional(),
    paths: GatewayPathsSchema.optional(),
    headers: GatewayHeaderEdits.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), 'Nothing to change')
  .openapi('UpdateSubscription');

export type SubscriptionView = z.infer<typeof SubscriptionSchema>;
export type AccountMeta = z.infer<typeof AccountMetaSchema>;
export type AddSubscription = z.infer<typeof AddSubscriptionSchema>;
export type UpdateSubscription = z.infer<typeof UpdateSubscriptionSchema>;
