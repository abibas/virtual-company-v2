import { z } from '@hono/zod-openapi';
import { ACCESS_PROFILE_NAME } from '@mwc/shared/credentials';
import { CredentialKind, CredentialStatus } from '@mwc/shared/enums';

/**
 * The access profiles API's shapes (`/api/me/access-profiles`, S3.4): a person's named bundles of their own
 * subscriptions. A slot shows its subscription's metadata, never a secret.
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

/** One of your subscriptions for a slot, or null to empty it. */
const slot = z.string().nullable().openapi({ example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b' });

/** A slot's subscription as a profile shows it: what it is and whose account, never its secret. */
export const SlotSubscriptionSchema = z
  .object({
    id: z.string(),
    kind: CredentialKind,
    label: z.string().openapi({ example: 'Max at home' }),
    accountEmail: z.string().nullable().openapi({ example: 'ihor@example.com' }),
    status: CredentialStatus,
  })
  .openapi('ProfileSlotSubscription');

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
    /** The Claude subscription of `claude_code` agents. */
    claude: SlotSubscriptionSchema.nullable(),
    /** The OpenAI subscription of `codex` agents. */
    openai: SlotSubscriptionSchema.nullable(),
    /** The gateway the runs send their AI requests through. */
    gateway: SlotSubscriptionSchema.nullable(),
    /** The agents that use it, in your companies. */
    agents: z.array(ProfileAgentSchema),
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('AccessProfile');

export const AccessProfileListSchema = z
  .object({ profiles: z.array(AccessProfileSchema) })
  .openapi('AccessProfileList');

/** A new profile: a name and, for each slot, one of your subscriptions of a kind it takes (or none). */
export const CreateAccessProfileSchema = z
  .object({
    name,
    claudeCredentialId: slot.optional(),
    openaiCredentialId: slot.optional(),
    gatewayCredentialId: slot.optional(),
  })
  .openapi('CreateAccessProfile');

/** A new name, a slot changed (null empties it), or both. */
export const UpdateAccessProfileSchema = z
  .object({
    name: name.optional(),
    claudeCredentialId: slot.optional(),
    openaiCredentialId: slot.optional(),
    gatewayCredentialId: slot.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Give at least one field to change')
  .openapi('UpdateAccessProfile');

export type AccessProfileView = z.infer<typeof AccessProfileSchema>;
export type SlotSubscriptionView = z.infer<typeof SlotSubscriptionSchema>;
export type ProfileAgentView = z.infer<typeof ProfileAgentSchema>;
export type CreateAccessProfile = z.infer<typeof CreateAccessProfileSchema>;
export type UpdateAccessProfile = z.infer<typeof UpdateAccessProfileSchema>;
