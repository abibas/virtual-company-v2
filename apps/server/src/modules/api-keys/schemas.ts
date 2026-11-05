import { z } from '@hono/zod-openapi';
import { PERSONAL_KEY_DAYS } from '@mwc/shared/api-keys';
import { ApiKeyKind } from '@mwc/shared/enums';

const companyId = z
  .string()
  .openapi({ param: { name: 'companyId', in: 'path' }, example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' });

export const ApiKeysParamsSchema = z.object({ companyId });

export const ApiKeyParamsSchema = z.object({
  companyId,
  keyId: z
    .string()
    .openapi({ param: { name: 'keyId', in: 'path' }, example: '019a4f0c-b3c4-7d5e-8f60-718293a4b5c6' }),
});

/** `?all=1` (or `true`): every personal key in the company with its owner, for admins and owners. */
export const ApiKeyListQuerySchema = z.object({
  all: z
    .enum(['0', '1', 'false', 'true'])
    .optional()
    .openapi({ param: { name: 'all', in: 'query' }, example: '1' }),
});

/** A name for the key and, optionally, how many days it lives (90 by default, 1 to 365). */
export const CreateApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(100).openapi({ example: 'laptop' }),
    expiresInDays: z
      .number()
      .int()
      .min(PERSONAL_KEY_DAYS.min)
      .max(PERSONAL_KEY_DAYS.max)
      .default(PERSONAL_KEY_DAYS.default)
      .openapi({ example: 90 }),
  })
  .openapi('CreateApiKey');

/** A key's state as of now: revoked wins over expired. */
export const ApiKeyStatus = z.enum(['active', 'expired', 'revoked']);

/** Who a key belongs to, in the `?all=1` list. */
export const ApiKeyOwnerSchema = z
  .object({
    principalId: z.string(),
    userId: z.string().nullable(),
    /** Their first and last name; null while they have not given one. */
    displayName: z.string().nullable(),
    email: z.string(),
  })
  .openapi('ApiKeyOwner');

/** A personal API key as the API shows it: never its hash, and its secret only once, when it is made. */
export const ApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: ApiKeyKind,
    prefix: z.string().openapi({ example: 'mwc_pk_AbCd', description: 'The first characters of the key' }),
    scopes: z.array(z.string()).openapi({
      description:
        'Empty: full access as the member who owns the key, in this company only (the only kind for now)',
    }),
    status: ApiKeyStatus,
    createdAt: z.string().openapi({ format: 'date-time' }),
    expiresAt: z.string().nullable().openapi({ format: 'date-time' }),
    lastUsedAt: z.string().nullable().openapi({ format: 'date-time' }),
    revokedAt: z.string().nullable().openapi({ format: 'date-time' }),
    owner: ApiKeyOwnerSchema.optional(),
  })
  .openapi('ApiKey');

export const CreatedApiKeySchema = ApiKeySchema.extend({
  secret: z.string().openapi({
    example: 'mwc_pk_AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    description: 'The whole key: shown in this response only, never stored or shown again',
  }),
}).openapi('CreatedApiKey');

export const ApiKeyListSchema = z.object({ apiKeys: z.array(ApiKeySchema) }).openapi('ApiKeyList');

export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;
export type ApiKeyView = z.infer<typeof ApiKeySchema>;
export type ApiKeyOwner = z.infer<typeof ApiKeyOwnerSchema>;
export type CreatedApiKeyView = z.infer<typeof CreatedApiKeySchema>;
