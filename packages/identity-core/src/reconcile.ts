import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import {
  type ProjectionChange,
  type ProjectionContext,
  project,
  projectionContext,
  replayDeferred,
} from './projector.ts';
import type { IdentityProvider } from './provider.ts';
import { type IdentityStore, identityKeys, type StoredMembership } from './store.ts';

/**
 * Reconcile: read the provider's current state and project it as synthetic events through the same
 * projector the webhooks use, so a missed or late webhook can never leave a different state. Runs on
 * sign-in (`reconcileUser`), periodically and on "Sync now" (`reconcileOrganization`).
 */

export interface ReconcileOptions {
  /** `occurredAt` of the synthetic events; the system clock by default. */
  readonly now?: () => Date;
}

export interface ReconcileSummary {
  /** Memberships the provider listed (for a user: those in companies we know). */
  readonly members: number;
  /** Invitations the provider listed. */
  readonly invitations: number;
  /** Active local memberships the provider no longer has, projected as deletions. */
  readonly removed: number;
  readonly changes: ProjectionChange[];
}

type Body = NormalizedIdentityEvent extends infer E
  ? E extends NormalizedIdentityEvent
    ? Pick<E, 'type' | 'data'>
    : never
  : never;

function synthetic(
  provider: IdentityProvider,
  body: Body,
  version: string,
  now: () => Date,
): NormalizedIdentityEvent {
  return {
    ...body,
    provider: provider.kind,
    externalEventId: `reconcile:${body.type}:${version}`,
    occurredAt: now().getTime(),
  } as NormalizedIdentityEvent;
}

/**
 * Projects a deletion for each local membership that is not removed, follows a provider membership, and
 * is not in `listed` (the provider no longer has it). Returns how many it projected and what changed.
 */
async function projectMissing(
  rows: readonly StoredMembership[],
  listed: ReadonlySet<string>,
  orgOf: (row: StoredMembership) => Promise<string | null>,
  provider: IdentityProvider,
  store: IdentityStore,
  ctx: ProjectionContext,
  now: () => Date,
): Promise<{ removed: number; changes: ProjectionChange[] }> {
  let removed = 0;
  const changes: ProjectionChange[] = [];
  for (const row of rows) {
    const externalMembershipId = row.externalMembershipId;
    if (row.status === 'removed' || externalMembershipId === null || listed.has(externalMembershipId))
      continue;
    const [user, orgExternalId] = await Promise.all([store.getUserById(row.userId), orgOf(row)]);
    if (!user || orgExternalId === null) continue;
    removed++;
    const data = { orgExternalId, subject: user.subject, externalMembershipId };
    const event = synthetic(provider, { type: 'membership.deleted', data }, externalMembershipId, now);
    changes.push(...(await project(event, store, ctx)));
  }
  return { removed, changes };
}

/**
 * Brings one company in line with its provider organization: first the events parked until the company
 * was linked to it, then each listed member (fetching a user not seen yet) and each accepted or revoked
 * invitation as synthetic upserts, then every active local membership whose provider membership is gone
 * as a synthetic deletion. Profile changes of known users come from user webhooks or `reconcileUser`.
 */
export async function reconcileOrganization(
  orgExternalId: string,
  provider: IdentityProvider,
  store: IdentityStore,
  options: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const ctx = projectionContext(provider);
  const now = options.now ?? (() => new Date());
  const company = await store.getCompanyByOrgExternalId(orgExternalId);
  if (!company) return { members: 0, invitations: 0, removed: 0, changes: [] };
  const changes = await replayDeferred(identityKeys.org(orgExternalId), store, ctx);
  const listed = new Set<string>();
  for await (const membership of provider.listOrganizationMembers(orgExternalId)) {
    listed.add(membership.externalMembershipId);
    if (!(await store.getUser(ctx.issuer, membership.subject))) {
      const user = await provider.getUser(membership.subject);
      if (user) {
        const event = synthetic(
          provider,
          { type: 'user.upserted', data: user },
          `${user.subject}:${user.updatedAt}`,
          now,
        );
        changes.push(...(await project(event, store, ctx)));
      }
    }
    const version = `${membership.externalMembershipId}:${membership.updatedAt}`;
    changes.push(
      ...(await project(
        synthetic(provider, { type: 'membership.upserted', data: membership }, version, now),
        store,
        ctx,
      )),
    );
  }
  const invitations = await provider.listInvitations(orgExternalId);
  for (const invitation of invitations) {
    if (invitation.status !== 'accepted' && invitation.status !== 'revoked') continue;
    const type = invitation.status === 'accepted' ? 'invitation.accepted' : 'invitation.revoked';
    const event = synthetic(
      provider,
      { type, data: invitation },
      `${invitation.externalId}:${invitation.updatedAt}`,
      now,
    );
    changes.push(...(await project(event, store, ctx)));
  }
  const missing = await projectMissing(
    await store.listMemberships({ companyId: company.id }),
    listed,
    async () => orgExternalId,
    provider,
    store,
    ctx,
    now,
  );
  changes.push(...missing.changes);
  return { members: listed.size, invitations: invitations.length, removed: missing.removed, changes };
}

/**
 * Reconcile-on-sign-in: the user as the provider has them (a user the provider no longer has is
 * projected as deleted), then their memberships in the companies we know, then each of their active
 * local memberships the provider no longer lists as a synthetic deletion (the provider's list of a
 * user's organizations is complete, so a missing one was removed). Invitations that were revoked without
 * being accepted are `reconcileOrganization`'s.
 */
export async function reconcileUser(
  subject: string,
  provider: IdentityProvider,
  store: IdentityStore,
  options: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const ctx = projectionContext(provider);
  const now = options.now ?? (() => new Date());
  const user = await provider.getUser(subject);
  if (!user) {
    const known = await store.getUser(ctx.issuer, subject);
    const changes = known
      ? await project(
          synthetic(provider, { type: 'user.deleted', data: { subject } }, subject, now),
          store,
          ctx,
        )
      : [];
    return { members: 0, invitations: 0, removed: 0, changes };
  }
  const changes = await project(
    synthetic(provider, { type: 'user.upserted', data: user }, `${subject}:${user.updatedAt}`, now),
    store,
    ctx,
  );
  const listed = new Set<string>();
  for (const { membership } of await provider.listUserOrganizations(subject)) {
    if (!(await store.getCompanyByOrgExternalId(membership.orgExternalId))) continue;
    listed.add(membership.externalMembershipId);
    const version = `${membership.externalMembershipId}:${membership.updatedAt}`;
    changes.push(
      ...(await project(
        synthetic(provider, { type: 'membership.upserted', data: membership }, version, now),
        store,
        ctx,
      )),
    );
  }
  const local = await store.getUser(ctx.issuer, subject);
  const missing = await projectMissing(
    local ? await store.listMemberships({ userId: local.id }) : [],
    listed,
    async (row) => (await store.getCompany(row.companyId))?.identityOrgExternalId ?? null,
    provider,
    store,
    ctx,
    now,
  );
  changes.push(...missing.changes);
  return { members: listed.size, invitations: 0, removed: missing.removed, changes };
}
