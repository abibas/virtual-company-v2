import type { Invitation, Membership, TenantDb } from '@mwc/db';
import { invitationStatusAt } from '@mwc/shared/identity';
import type { ServerDeps } from '../../platform/env.ts';
import { type ChartDeps, profilesOf, type UserProfile } from '../identity/service.ts';
import { membersRepo } from './repo.ts';
import { type InvitationFilter, type Refusal, storedStatuses } from './rules.ts';
import type { InvitationView, MemberView } from './schemas.ts';
import {
  createInvitation,
  type InvitationChange,
  type InvitationResult,
  type NewInvitation,
  type Resend,
  resendInvitation,
  revokeInvitation,
} from './service/invitations.ts';
import { type Removal, removeMember } from './service/remove.ts';
import { changeRole, type RoleChange } from './service/role.ts';

/** What the members module's routes and services need: the database, and the org chart a removal changes. */
export type MembersDeps = Pick<ServerDeps, 'db'> & ChartDeps;

/** Who a membership names when their profile is missing (never, while `memberships.user_id` keeps its key). */
const UNKNOWN_PROFILE = { displayName: null, primaryEmail: '', imageUrl: null } as const;

/** A membership as the API shows it, with the person's name, email and picture from their (global) profile. */
export function memberView(
  row: Membership,
  profile: Omit<UserProfile, 'id' | 'status'> | undefined,
): MemberView {
  const { displayName, primaryEmail, imageUrl } = profile ?? UNKNOWN_PROFILE;
  return {
    id: row.id,
    userId: row.userId,
    principalId: row.principalId,
    displayName,
    email: primaryEmail,
    imageUrl,
    role: row.role,
    status: row.status,
    joinedAt: row.createdAt.toISOString(),
  };
}

/**
 * The members module's logic: the member list, role changes and removals (`service/role.ts`, `service/remove.ts`);
 * the outbox handlers are in `service/provider.ts`. People's profiles are global rows, read through the identity
 * module's service. A removal takes the person off the org chart through `chart` (the org module's, from `createApp`).
 */
export function membersService(deps: MembersDeps) {
  const repo = membersRepo();
  const views = async (rows: readonly Membership[]) => {
    const profiles = await profilesOf(
      deps.db,
      rows.map((row) => row.userId),
    );
    return rows.map((row) => memberView(row, profiles.get(row.userId)));
  };
  return {
    list: async (t: TenantDb): Promise<MemberView[]> => views(await repo.list(t)),

    async changeRole(t: TenantDb, call: RoleChange): Promise<{ ok: true; member: MemberView } | Refusal> {
      const result = await changeRole(repo, t, call);
      if (!result.ok) return result;
      const [member] = await views([result.membership]);
      return { ok: true, member: member as MemberView };
    },

    remove: (t: TenantDb, call: Removal) => removeMember(repo, t, call, deps.chart),
  };
}

export type MembersService = ReturnType<typeof membersService>;

/** An invitation as the API shows it, with its status as of `now` (never its provider id). */
export function invitationView(row: Invitation, now: Date): InvitationView {
  return {
    id: row.id,
    email: row.emailNormalized,
    role: row.role,
    status: invitationStatusAt(row.status, row.expiresAt, now),
    expiresAt: row.expiresAt.toISOString(),
    sent: row.externalInvitationId !== null,
    invitedByPrincipalId: row.invitedByPrincipalId,
    acceptedByUserId: row.acceptedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A call the routes make without the redirect URL, which the service adds from the configuration. */
type FromRoute<T> = Omit<T, 'redirectUrl'>;
type ViewResult = { readonly ok: true; readonly invitation: InvitationView } | Refusal;

/**
 * The invitations' logic: the list, and creating, resending and revoking one (`service/invitations.ts`); the outbox
 * handlers are in `service/invitation-provider.ts`. The provider's emailed link lands on the web's
 * `/accept-invitation` (`MWC_WEB_ORIGIN`).
 */
export function invitationsService(deps: Pick<ServerDeps, 'db' | 'config'>) {
  const repo = membersRepo();
  const redirectUrl = `${deps.config.MWC_WEB_ORIGIN}/accept-invitation`;
  const view = async (now: Date, work: Promise<InvitationResult>): Promise<ViewResult> => {
    const result = await work;
    return result.ok ? { ok: true, invitation: invitationView(result.invitation, now) } : result;
  };
  return {
    /** The company's invitations whose status as of `now` is `filter` (or all), newest first. */
    async list(t: TenantDb, filter: InvitationFilter, now: Date): Promise<InvitationView[]> {
      const rows = await repo.listInvitations(t, storedStatuses(filter));
      return rows
        .map((row) => invitationView(row, now))
        .filter((row) => filter === 'all' || row.status === filter);
    },

    create: (t: TenantDb, call: FromRoute<NewInvitation>) =>
      view(call.now, createInvitation(deps.db, repo, t, { ...call, redirectUrl })),

    resend: (t: TenantDb, call: FromRoute<Resend>) =>
      view(call.now, resendInvitation(repo, t, { ...call, redirectUrl })),

    revoke: (t: TenantDb, call: InvitationChange) => revokeInvitation(repo, t, call),
  };
}
