import { InvitationStatus, MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { accessProfiles } from './credentials.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';
import { users } from './users.ts';

/**
 * An invitation to a company. The provider's invitation is linked back by `external_invitation_id` and by
 * our id in its metadata, never by the email. At most one pending invitation per email and company.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    /** Lower-cased; the CHECK refuses anything else. */
    emailNormalized: text('email_normalized').notNull(),
    role: text('role').$type<MembershipRole>().notNull(),
    status: text('status').$type<InvitationStatus>().notNull().default('pending'),
    externalInvitationId: text('external_invitation_id').unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Who sent it; null for invitations nobody here sent (provider or directory imports). */
    invitedByPrincipalId: uuid('invited_by_principal_id'),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('invitations', t),
    tenantForeignKey('invitations_invited_by_principal_fk', t.companyId, t.invitedByPrincipalId, principals),
    check('invitations_email_lower_check', sql`${t.emailNormalized} = lower(${t.emailNormalized})`),
    check('invitations_role_check', oneOf(t.role, MembershipRole.options)),
    check('invitations_status_check', oneOf(t.status, InvitationStatus.options)),
    uniqueIndex('invitations_one_pending_per_email')
      .on(t.companyId, t.emailNormalized)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * A person in a company: their principal there, the role that applies (`role`), the role this product
 * granted (`granted_role`), and the provider membership it follows. One per company and user. The rule
 * "at least one active owner" is the members service's (S1.6), not a trigger.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    principalId: uuid('principal_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** What applies: `granted_role`, raised to admin while the provider says admin. */
    role: text('role').$type<MembershipRole>().notNull(),
    /** What this product granted: the invitation's role or a local change, never the provider's. */
    grantedRole: text('granted_role').$type<MembershipRole>().notNull(),
    status: text('status').$type<MembershipStatus>().notNull().default('active'),
    externalMembershipId: text('external_membership_id'),
    /** The provider role of the newest provider state applied (Clerk `org:admin`). */
    providerRole: text('provider_role'),
    /** The invitation this membership came from. */
    invitationId: uuid('invitation_id'),
    /**
     * The person's own Claude access profile for the `claude_code` agents they hire here (S3.4, one per provider since
     * 2026-11-10); none by default. A personal row, so a plain key: it goes when the profile does.
     */
    defaultClaudeProfileId: uuid('default_claude_profile_id').references(() => accessProfiles.id, {
      onDelete: 'set null',
    }),
    /** Their OpenAI access profile for the `codex` agents they hire here; none by default. */
    defaultOpenaiProfileId: uuid('default_openai_profile_id').references(() => accessProfiles.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('memberships', t),
    unique('memberships_company_id_user_id_unique').on(t.companyId, t.userId),
    unique('memberships_company_id_principal_id_unique').on(t.companyId, t.principalId),
    tenantForeignKey('memberships_principal_fk', t.companyId, t.principalId, principals),
    tenantForeignKey('memberships_invitation_fk', t.companyId, t.invitationId, invitations),
    check('memberships_role_check', oneOf(t.role, MembershipRole.options)),
    check('memberships_granted_role_check', oneOf(t.grantedRole, MembershipRole.options)),
    check('memberships_status_check', oneOf(t.status, MembershipStatus.options)),
    index('memberships_user_id_idx').on(t.userId),
    index('memberships_default_claude_profile_idx').on(t.defaultClaudeProfileId),
    index('memberships_default_openai_profile_idx').on(t.defaultOpenaiProfileId),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
