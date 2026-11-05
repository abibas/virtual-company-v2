import { z } from '@hono/zod-openapi';

/**
 * The org API's shapes of access profiles (S3.4): the profile an agent's runs use, as agents and the chart show it
 * (never a subscription of it), and a member's default for the agents they hire.
 */

/** The access profile an agent uses: its name and whose it is, never its subscriptions. */
export const AgentProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    ownerUserId: z.string(),
    /** The owner's first and last name, else their email. */
    ownerName: z.string().openapi({ example: 'Ihor Herasko' }),
  })
  .openapi('AgentProfile');

/** A profile in a change: one of yours to give, or null for none. */
export const ProfileChoice = z
  .string()
  .nullable()
  .openapi({ example: '019a5b20-1a2b-7c3d-8e4f-5a6b7c8d9e0f' });

/** A member's default profile for the agents they hire: one of theirs, or null for none. */
export const DefaultProfileBodySchema = z
  .object({ profileId: ProfileChoice })
  .openapi('DefaultProfileChoice');

export const DefaultProfileSchema = z
  .object({ defaultProfileId: z.string().nullable() })
  .openapi('DefaultProfile');

export type AgentProfileView = z.infer<typeof AgentProfileSchema>;
export type DefaultProfileView = z.infer<typeof DefaultProfileSchema>;
