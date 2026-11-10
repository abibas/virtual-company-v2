import { z } from '@hono/zod-openapi';
import { ACCESS_PROFILE_NAME } from '@mwc/shared/credentials';
import { CredentialKind, CredentialStatus, ProfileProvider } from '@mwc/shared/enums';

/**
 * The access profiles API's shapes (`/api/me/access-profiles`, S3.4, one provider each since 2026-11-10): a person's
 * named choice of one of their own subscriptions, Claude's or OpenAI's, with an optional gateway of that provider. A
 * credential shows its subscription's metadata, never a secret.
 */

export const AccessProfileParamsSchema = z.object({
  profileId: z.string().openapi({
    param: { name: 'profileId', in: 'path' },
    example: '019a5b20-1a2b-7c3d-8e4f-5a6b7c8d9e0f',
  }),
});

const name = z
  .string()
  .trim()
  .min(ACCESS_PROFILE_NAME.min, 'A name is required')
  .max(ACCESS_PROFILE_NAME.max, `A name is at most ${ACCESS_PROFILE_NAME.max} characters`)
  .openapi({ example: 'Work' });

/** Whose subscription it holds: fixed when it is made. */
const provider = ProfileProvider;

/** One of your subscriptions, or null to empty the profile's. */
const choice = z.string().nullable().openapi({ example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b' });

/** A profile's subscription or gateway as it shows it: what it is and whose account, never its secret. */
export const ProfileSubscriptionSchema = z
  .object({
    id: z.string(),
    kind: CredentialKind,
    label: z.string().openapi({ example: 'Max at home' }),
    accountEmail: z.string().nullable().openapi({ example: 'ihor@example.com' }),
    status: CredentialStatus,
  })
  .openapi('ProfileSubscription');

/** An agent that uses the profile, and its company. */
export const ProfileAgentSchema = z
  .object({
    companyId: z.string(),
    companySlug: z.string().openapi({ example: 'most-wanted' }),
    companyName: z.string().openapi({ example: 'Most Wanted' }),
    agentId: z.string(),
    agentName: z.string().openapi({ example: 'SLOP BOX' }),
    agentSlug: z.string().openapi({ example: 'slop-box' }),
  })
  .openapi('ProfileAgent');

export const AccessProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    /** Claude for `claude_code` agents, OpenAI for `codex` agents. */
    provider: ProfileProvider,
    /** Its subscription of that provider; null while it has none (it cannot run until it does). */
    subscription: ProfileSubscriptionSchema.nullable(),
    /** Its gateway (of its provider), which its runs send their AI requests through; null for none. */
    gateway: ProfileSubscriptionSchema.nullable(),
    /** The agents that use it, in your companies. */
    agents: z.array(ProfileAgentSchema),
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('AccessProfile');

export const AccessProfileListSchema = z
  .object({ profiles: z.array(AccessProfileSchema) })
  .openapi('AccessProfileList');

/**
 * A new profile: a name, its provider and, optionally, one of your subscriptions and one of your gateways of that
 * provider (an `anthropic` gateway for Claude, an `openai` one for OpenAI).
 */
export const CreateAccessProfileSchema = z
  .object({
    name,
    provider,
    credentialId: choice.optional(),
    gatewayCredentialId: choice.optional(),
  })
  .openapi('CreateAccessProfile');

/**
 * A new name, another subscription or gateway of the same provider, any of them (null empties one). The provider is
 * fixed: given, it must be the profile's own.
 */
export const UpdateAccessProfileSchema = z
  .object({
    name: name.optional(),
    provider: provider.optional(),
    credentialId: choice.optional(),
    gatewayCredentialId: choice.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Give at least one field to change')
  .openapi('UpdateAccessProfile');

export type AccessProfileView = z.infer<typeof AccessProfileSchema>;
export type ProfileSubscriptionView = z.infer<typeof ProfileSubscriptionSchema>;
export type ProfileAgentView = z.infer<typeof ProfileAgentSchema>;
export type CreateAccessProfile = z.infer<typeof CreateAccessProfileSchema>;
export type UpdateAccessProfile = z.infer<typeof UpdateAccessProfileSchema>;
