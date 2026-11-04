import {
  type ExternalInvitation,
  type ExternalMembership,
  type ExternalUser,
  IDENTITY_METADATA,
  type MembershipRole,
  type NormalizedIdentityEvent,
} from '@mwc/shared/identity';
import type { IdentityProvider, ProviderRoleMap } from './provider.ts';
import {
  type IdentityStore,
  type InvitationPatch,
  identityKeys,
  type NewStoredMembership,
  type StoredInvitation,
  type StoredUser,
} from './store.ts';

/**
 * The projector: the single, idempotent place where external identity state becomes local state. Every
 * path (webhook, reconcile-on-sign-in, periodic reconcile, manual sync) hands it normalized events.
 *
 * It is order-safe: the same set of events, applied in any order and any number of times, leaves the
 * same state. That rests on four rules (README.md has the full list):
 * - fields follow the newest provider state by `updatedAt` (a mark per entity); older upserts are ignored;
 * - deletions are sticky flags (a deleted user stays deactivated, a deleted provider membership never
 *   makes a row active) and never move the mark, so fields still follow the newest upsert;
 * - an event whose user or company is not known yet is parked and replayed when it is;
 * - a membership is linked to a local invitation by `mwc_invitation_id`, else by the provider's
 *   invitation id, never by email, and takes its role from that invitation;
 * - a refused event (an unlinked membership, an invitation of another company) changes nothing at all,
 *   so it commutes with every other event.
 * Deduplicating deliveries by `externalEventId` is the caller's job (S1.3); applying one twice is a no-op.
 */

export interface ProjectionContext {
  /** The provider's token issuer: users are `(issuer, subject)`. */
  readonly issuer: string;
  /** Only `isAdmin` is read: an admin provider role promotes to admin. */
  readonly roles: Pick<ProviderRoleMap, 'isAdmin'>;
}

export function projectionContext(provider: Pick<IdentityProvider, 'issuer' | 'roles'>): ProjectionContext {
  return { issuer: provider.issuer, roles: provider.roles };
}

/** One changed field; the same shape as `@mwc/db`'s `diffFields`, so S1.3 writes it as audit rows. */
export interface FieldChange {
  readonly field: string;
  readonly old: unknown;
  readonly new: unknown;
}

export type ProjectionAction =
  | 'created'
  | 'updated'
  | 'deactivated'
  | 'removed'
  | 'reactivated'
  | 'accepted'
  | 'revoked'
  /** Nothing to do: older than what is applied, a duplicate, or not ours. */
  | 'ignored'
  /** Parked until its user or company exists. */
  | 'deferred'
  /** Refused by a local rule (unlinked membership, revoked invitation); S1.7 may undo it at the provider. */
  | 'refused';

/** What one event did, for audit rows (S1.3) and for the lifecycle hooks of later stages. */
export interface ProjectionChange {
  readonly entity: 'user' | 'membership' | 'invitation' | 'company';
  readonly action: ProjectionAction;
  /** The local row, when there is one. */
  readonly id: string | null;
  readonly companyId: string | null;
  readonly fields: readonly FieldChange[];
  readonly reason: string | null;
  /** The `externalEventId` of the event that caused it. */
  readonly eventId: string;
}

type Event<T extends NormalizedIdentityEvent['type']> = Extract<NormalizedIdentityEvent, { type: T }>;

function change(
  event: NormalizedIdentityEvent,
  entity: ProjectionChange['entity'],
  action: ProjectionAction,
  options: {
    id?: string | null;
    companyId?: string | null;
    fields?: readonly FieldChange[];
    reason?: string;
  } = {},
): ProjectionChange {
  return {
    entity,
    action,
    id: options.id ?? null,
    companyId: options.companyId ?? null,
    fields: options.fields ?? [],
    reason: options.reason ?? null,
    eventId: event.externalEventId,
  };
}

function diff<T extends object>(
  before: T | undefined,
  after: T,
  fields: readonly (keyof T & string)[],
): FieldChange[] {
  return fields
    .filter((field) => before?.[field] !== after[field])
    .map((field) => ({ field, old: before?.[field] ?? null, new: after[field] }));
}

const USER_FIELDS = ['primaryEmail', 'displayName', 'imageUrl', 'status'] as const;
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

/** Applies one normalized event to the store; returns what changed (and what was ignored and why). */
export async function project(
  event: NormalizedIdentityEvent,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  switch (event.type) {
    case 'user.upserted':
      return projectUserUpserted(event, store, ctx);
    case 'user.deleted':
      return projectUserDeleted(event, store, ctx);
    case 'org.upserted':
      return projectOrgUpserted(event, store, ctx);
    case 'org.deleted': {
      // Companies are local-first: the provider deleting the organization changes nothing here. S1.5
      // decides what to do (and a local company delete removes the organization, not the other way).
      const company = await store.getCompanyByOrgExternalId(event.data.externalId);
      return [
        change(event, 'company', 'ignored', { id: company?.id ?? null, reason: 'org_deleted_upstream' }),
      ];
    }
    case 'membership.upserted':
      return projectMembershipUpserted(event, store, ctx);
    case 'membership.deleted':
      return projectMembershipDeleted(event, store, ctx);
    case 'invitation.accepted':
    case 'invitation.revoked':
      return projectInvitation(event, store);
  }
}

/** Replays the events parked under a key (`identityKeys.user(...)` or `identityKeys.org(...)`). */
export async function replayDeferred(
  key: string,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const changes: ProjectionChange[] = [];
  for (const parked of await store.takeDeferred(key)) changes.push(...(await project(parked, store, ctx)));
  return changes;
}

async function projectUserUpserted(
  event: Event<'user.upserted'>,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const data: ExternalUser = event.data;
  const key = identityKeys.user(ctx.issuer, data.subject);
  const [existing, mark] = await Promise.all([store.getUser(ctx.issuer, data.subject), store.getMark(key)]);
  const changes: ProjectionChange[] = [];
  if (existing && mark?.at != null && data.updatedAt <= mark.at) {
    changes.push(change(event, 'user', 'ignored', { id: existing.id, reason: 'not_newer' }));
  } else {
    // A deleted user stays deactivated; an upsert older than the deletion still fills in a user never
    // seen before, so every order ends with the same row.
    const deleted = mark?.deleted ?? false;
    const next = {
      issuer: ctx.issuer,
      subject: data.subject,
      primaryEmail: data.primaryEmail.toLowerCase(),
      displayName: data.displayName,
      imageUrl: data.imageUrl ?? null,
      status: deleted ? ('deactivated' as const) : (existing?.status ?? ('active' as const)),
    };
    const saved = await store.upsertUser(next);
    await store.setMark(key, { at: Math.max(mark?.at ?? data.updatedAt, data.updatedAt), deleted });
    const fields = diff<Omit<StoredUser, 'id'>>(existing, next, USER_FIELDS);
    if (!existing) changes.push(change(event, 'user', 'created', { id: saved.id, fields }));
    else if (fields.length > 0) changes.push(change(event, 'user', 'updated', { id: saved.id, fields }));
  }
  changes.push(...(await replayDeferred(key, store, ctx)));
  return changes;
}

async function projectUserDeleted(
  event: Event<'user.deleted'>,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const key = identityKeys.user(ctx.issuer, event.data.subject);
  const mark = await store.getMark(key);
  if (!mark?.deleted) await store.setMark(key, { at: mark?.at ?? null, deleted: true });
  const user = await store.getUser(ctx.issuer, event.data.subject);
  if (!user) return [change(event, 'user', 'ignored', { reason: 'unknown_user' })];
  const changes: ProjectionChange[] = [];
  if (user.status !== 'deactivated') {
    await store.upsertUser({ ...user, status: 'deactivated' });
    changes.push(
      change(event, 'user', 'deactivated', {
        id: user.id,
        fields: [{ field: 'status', old: user.status, new: 'deactivated' }],
      }),
    );
  }
  // A deleted person keeps no membership: the same end state as if each membership's deletion had come.
  for (const membership of await store.listMemberships({ userId: user.id })) {
    if (membership.status === 'removed') continue;
    const { id, ...rest } = membership;
    await store.upsertMembership({ ...rest, status: 'removed' });
    changes.push(
      change(event, 'membership', 'removed', {
        id,
        companyId: membership.companyId,
        fields: [{ field: 'status', old: membership.status, new: 'removed' }],
        reason: 'user_deleted',
      }),
    );
  }
  return changes.length > 0
    ? changes
    : [change(event, 'user', 'ignored', { id: user.id, reason: 'already_deleted' })];
}

async function projectOrgUpserted(
  event: Event<'org.upserted'>,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const company = await store.getCompanyByOrgExternalId(event.data.externalId);
  if (!company) return [change(event, 'company', 'ignored', { reason: 'unknown_company' })];
  // The company's own fields are local; the organization showing up is the moment its parked events can run.
  const replayed = await replayDeferred(identityKeys.org(event.data.externalId), store, ctx);
  return replayed.length > 0
    ? replayed
    : [change(event, 'company', 'ignored', { id: company.id, reason: 'company_is_local' })];
}

interface Link {
  readonly invitation: StoredInvitation;
  /** Why this invitation cannot be claimed by this membership, or null when it can. */
  readonly refused: string | null;
}

/** The local invitation a membership came from: by `mwc_invitation_id`, else by the provider's invitation id. */
async function findLink(
  membership: ExternalMembership,
  companyId: string,
  userId: string,
  store: IdentityStore,
): Promise<Link | undefined> {
  const metadataId = membership.metadata[IDENTITY_METADATA.invitationId];
  let invitation = typeof metadataId === 'string' ? await store.getInvitation(metadataId) : undefined;
  if (!invitation && membership.externalInvitationId !== undefined) {
    invitation = await store.getInvitationByExternalId(membership.externalInvitationId);
  }
  if (!invitation) return undefined;
  let refused: string | null = null;
  if (invitation.companyId !== companyId) refused = 'invitation_other_company';
  else if (
    invitation.status === 'revoked' ||
    invitation.status === 'expired' ||
    invitation.status === 'failed'
  ) {
    refused = `invitation_${invitation.status}`;
  } else if (invitation.acceptedByUserId !== null && invitation.acceptedByUserId !== userId) {
    refused = 'invitation_claimed';
  }
  return { invitation, refused };
}

/**
 * The person accepted the invitation: a fact, whatever order the events come in. The provider's id of the
 * invitation is learned here too when the local row does not know it yet (as `invitation.accepted` does),
 * so both orders end with it.
 */
async function acceptInvitation(
  event: NormalizedIdentityEvent,
  invitation: StoredInvitation,
  userId: string,
  externalInvitationId: string | undefined,
  store: IdentityStore,
): Promise<ProjectionChange[]> {
  const patch: InvitationPatch = {
    ...(invitation.acceptedByUserId === null
      ? { status: 'accepted' as const, acceptedByUserId: userId }
      : {}),
    ...(invitation.externalInvitationId === null && externalInvitationId !== undefined
      ? { externalInvitationId }
      : {}),
  };
  if (Object.keys(patch).length === 0) return [];
  await store.updateInvitation(invitation.id, patch);
  return [
    change(event, 'invitation', invitation.status === 'pending' ? 'accepted' : 'updated', {
      id: invitation.id,
      companyId: invitation.companyId,
      fields: diff(invitation, { ...invitation, ...patch }, [
        'status',
        'acceptedByUserId',
        'externalInvitationId',
      ]),
    }),
  ];
}

async function projectMembershipUpserted(
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

async function projectMembershipDeleted(
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

async function projectInvitation(
  event: Event<'invitation.accepted' | 'invitation.revoked'>,
  store: IdentityStore,
): Promise<ProjectionChange[]> {
  const data: ExternalInvitation = event.data;
  const metadataId = data.metadata[IDENTITY_METADATA.invitationId];
  const local =
    (typeof metadataId === 'string' ? await store.getInvitation(metadataId) : undefined) ??
    (await store.getInvitationByExternalId(data.externalId));
  if (!local) return [change(event, 'invitation', 'ignored', { reason: 'unknown_invitation' })];
  const on = { id: local.id, companyId: local.companyId };
  const company = await store.getCompanyByOrgExternalId(data.orgExternalId);
  if (company?.id !== local.companyId) {
    return [change(event, 'invitation', 'ignored', { ...on, reason: 'invitation_other_company' })];
  }
  if (local.externalInvitationId !== null && local.externalInvitationId !== data.externalId) {
    // About a provider invitation this row no longer follows (it was sent again with the same metadata):
    // revoking the old one must not revoke ours.
    return [change(event, 'invitation', 'ignored', { ...on, reason: 'other_provider_invitation' })];
  }
  const accepted = event.type === 'invitation.accepted';
  const target: 'accepted' | 'revoked' = accepted ? 'accepted' : 'revoked';
  if (local.status === 'pending') {
    const patch: InvitationPatch = {
      status: target,
      ...(local.externalInvitationId === null ? { externalInvitationId: data.externalId } : {}),
    };
    await store.updateInvitation(local.id, patch);
    return [
      change(event, 'invitation', target, {
        ...on,
        fields: diff(local, { ...local, ...patch }, ['status', 'externalInvitationId']),
      }),
    ];
  }
  // Local decisions win: a revoked or expired invitation stays so even when the provider accepted it
  // (S1.7 then removes the membership there), and an accepted one is not revoked.
  const terminal = local.status === 'revoked' || local.status === 'expired' || local.status === 'failed';
  const reason = local.status === target ? `already_${target}` : `invitation_${local.status}`;
  const note = change(event, 'invitation', accepted && terminal ? 'refused' : 'ignored', { ...on, reason });
  if (local.externalInvitationId !== null) return [note];
  // The provider id is still learned (the membership may have accepted it first), so every order ends with it.
  await store.updateInvitation(local.id, { externalInvitationId: data.externalId });
  const learned = change(event, 'invitation', 'updated', {
    ...on,
    fields: [{ field: 'externalInvitationId', old: null, new: data.externalId }],
  });
  return note.action === 'refused' ? [learned, note] : [learned];
}
