import { z } from 'zod';

/**
 * Enums stored as `text` columns with a CHECK constraint (`@mwc/db` builds the CHECK from
 * `.options`), so the database and the API accept exactly the same values.
 */

/** `companies.status`: provisioning until the identity provider has the organization. */
export const CompanyStatus = z.enum(['provisioning', 'active', 'suspended', 'deleted']);
export type CompanyStatus = z.infer<typeof CompanyStatus>;

/** `users.status`: a deactivated user keeps their rows but cannot sign in. */
export const UserStatus = z.enum(['active', 'deactivated']);
export type UserStatus = z.infer<typeof UserStatus>;

/** `audit_log.actor_kind`: who made a change (a person, an agent, the system, the identity provider). */
export const ActorKind = z.enum(['user', 'agent', 'system', 'identity']);
export type ActorKind = z.infer<typeof ActorKind>;
