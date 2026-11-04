import type { MembershipRole } from '@mwc/shared/identity';
import type { ProviderRoleMap } from '../provider.ts';
import { type IdentityStore, identityKeys, type NewStoredMembership } from '../store.ts';
import { change, diff, type Event, type ProjectionChange, type ProjectionContext } from './changes.ts';
import { acceptInvitation, findLink } from './membership-link.ts';

const MEMBERSHIP_FIELDS = [
  'role',
  'grantedRole',
  'status',
  'externalMembershipId',
  'providerRole',
  'invitationId',
] as const;

/**
 * The role that applies: an owner stays owner whatever the provider says, an admin provider role
 * promotes to admin (never to owner), and otherwise the granted role stands. A function of the granted
 * role and the newest provider role only, so the order the provider's changes arrive in does not matter.
 */
export function effectiveRole(
  grantedRole: MembershipRole,
  providerRole: string | null,
  roles: Pick<ProviderRoleMap, 'isAdmin'>,
): MembershipRole {
  if (grantedRole === 'owner') return 'owner';
  return providerRole !== null && roles.isAdmin(providerRole) ? 'admin' : grantedRole;
}

export async function projectMembershipUpserted(
  event: Event<'membership.upserted'>,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const data = event.data;
  const company = await store.getCompanyByOrgExternalId(data.orgExternalId);
  if (!company) {
    await store.defer(identityKeys.org(data.orgExternalId), event);
    return [change(event, 'membership', 'deferred', { reason: 'unknown_company' })];
  }
  const user = await store.getUser(ctx.issuer, data.subject);
  if (!user) {
    await store.defer(identityKeys.user(ctx.issuer, data.subject), event);
    return [change(event, 'membership', 'deferred', { companyId: company.id, reason: 'unknown_user' })];
  }
  const rowKey = identityKeys.membership(company.id, user.id);
  const [existing, rowMark, externalMark, link] = await Promise.all([
    store.getMembership(company.id, user.id),
    store.getMark(rowKey),
    store.getMark(identityKeys.externalMembership(data.externalMembershipId)),
    findLink(data, company.id, user.id, store),
  ]);
  const valid = link !== undefined && link.refused === null;
  const changes = valid
    ? await acceptInvitation(event, link.invitation, user.id, data.externalInvitationId, store)
    : [];
  const on = { id: existing?.id ?? null, companyId: company.id };

  if (existing && rowMark?.at != null && data.updatedAt <= rowMark.at) {
    return [...changes, change(event, 'membership', 'ignored', { ...on, reason: 'not_newer' })];
  }
  // A provider membership that was deleted, or a deleted person, never makes a row active.
  const gone = externalMark?.deleted === true || user.status === 'deactivated';
  let next: NewStoredMembership;
  if (!existing) {
    // Only an invitation of this company brings someone in; an email match never does.
    if (!link || link.refused !== null) {
      return [
        ...changes,
        change(event, 'membership', 'refused', { ...on, reason: link?.refused ?? 'unlinked' }),
      ];
    }
    next = {
      companyId: company.id,
      userId: user.id,
      grantedRole: link.invitation.role,
      role: link.invitation.role,
      status: gone ? 'removed' : 'active',
      externalMembershipId: data.externalMembershipId,
      providerRole: data.providerRole,
      invitationId: link.invitation.id,
    };
  } else {
    const sameMembership = existing.externalMembershipId === data.externalMembershipId;
    // A row made here (the company's creator) takes the first provider membership that comes as its own.
    const adopting = existing.externalMembershipId === null;
    if (!sameMembership && !adopting && !valid) {
      // Another provider membership replaces the one this row follows (re-added in the provider's dashboard
      // after a removal) without a valid invitation of this company. Refused, and the row is left exactly
      // as it is: otherwise the person stays in or not depending on whether the old membership's deletion
      // came first.
      return [change(event, 'membership', 'refused', { ...on, reason: link?.refused ?? 'unlinked' })];
    }
    const { id: _id, ...current } = existing;
    next = { ...current, externalMembershipId: data.externalMembershipId, providerRole: data.providerRole };
    // A new provider membership from a valid invitation (a re-invite after removal, or the provider side of
    // a row made locally) takes that invitation's role and makes the row active. Anything else keeps the
    // granted role and status: a removal made here stays in force.
    const newcomer = !sameMembership || existing.status === 'invited';
    if (valid && newcomer) {
      next = {
        ...next,
        grantedRole: link.invitation.role,
        invitationId: link.invitation.id,
        status: 'active',
      };
    } else if (link?.refused != null && newcomer) {
      changes.push(change(event, 'membership', 'refused', { ...on, reason: link.refused }));
    }
    if (gone) next = { ...next, status: 'removed' };
  }
  next = { ...next, role: effectiveRole(next.grantedRole, next.providerRole, ctx.roles) };

  const saved = await store.upsertMembership(next);
  await store.setMark(rowKey, {
    at: Math.max(rowMark?.at ?? data.updatedAt, data.updatedAt),
    deleted: false,
  });
  const fields = diff<NewStoredMembership>(existing, next, MEMBERSHIP_FIELDS);
  const where = { id: saved.id, companyId: company.id, fields };
  if (!existing) changes.push(change(event, 'membership', 'created', where));
  else if (existing.status === 'removed' && next.status === 'active')
    changes.push(change(event, 'membership', 'reactivated', where));
  else if (existing.status !== 'removed' && next.status === 'removed') {
    const reason = user.status === 'deactivated' ? 'user_deleted' : 'provider_deleted';
    changes.push(change(event, 'membership', 'removed', { ...where, reason }));
  } else if (fields.length > 0) changes.push(change(event, 'membership', 'updated', where));
  return changes;
}

export async function projectMembershipDeleted(
  event: Event<'membership.deleted'>,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const data = event.data;
  const externalKey = identityKeys.externalMembership(data.externalMembershipId);
  const mark = await store.getMark(externalKey);
  // Recorded even when the row is not known yet: a later (or parked) upsert of it then lands removed.
  if (!mark?.deleted) await store.setMark(externalKey, { at: mark?.at ?? null, deleted: true });
  const company = await store.getCompanyByOrgExternalId(data.orgExternalId);
  const user = company ? await store.getUser(ctx.issuer, data.subject) : undefined;
  const row = company && user ? await store.getMembership(company.id, user.id) : undefined;
  if (!row || row.externalMembershipId !== data.externalMembershipId) {
    return [
      change(event, 'membership', 'ignored', {
        id: row?.id ?? null,
        companyId: company?.id ?? null,
        reason: row ? 'other_membership' : 'unknown_membership',
      }),
    ];
  }
  if (row.status === 'removed') {
    return [
      change(event, 'membership', 'ignored', {
        id: row.id,
        companyId: row.companyId,
        reason: 'already_removed',
      }),
    ];
  }
  const { id, ...rest } = row;
  await store.upsertMembership({ ...rest, status: 'removed' });
  return [
    change(event, 'membership', 'removed', {
      id,
      companyId: row.companyId,
      fields: [{ field: 'status', old: row.status, new: 'removed' }],
      reason: 'provider_deleted',
    }),
  ];
}
