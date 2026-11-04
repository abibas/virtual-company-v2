import { CompanyNotFoundError, type DbHandle } from '@mwc/db';
import {
  type IdentityProvider,
  type IdentityStore,
  type ProjectionChange,
  project,
  projectionContext,
  reconcileOrganization,
} from '@mwc/identity-core';
import {
  type ExternalInvitation,
  type ExternalMembership,
  IDENTITY_METADATA,
  type NormalizedIdentityEvent,
} from '@mwc/shared/identity';
import { type ProviderRemoval, queueProviderRemovals } from '../../members/service/provider.ts';
import { dbIdentityStore, replacedInvitations } from '../repo.ts';

/**
 * Two of the three paths that bring provider state in, both through the one projector on the database store (the
 * third, reconcile on sign-in, is `GET /api/me` in `../service.ts`): a normalized webhook event
 * (`projectIdentityEvent`, which S1.8's webhook inbox calls) and a whole company (`reconcileCompany`: the jobs loop of
 * S1.10 and `POST /api/companies/:companyId/sync`). The store reads an invitation past its expiry as expired, so an
 * acceptance after the expiry never activates anyone; after projecting, a provider membership that came from an
 * invitation revoked, expired or failed here is queued for removal at the provider (our database wins).
 */

export interface SyncDeps {
  readonly db: DbHandle;
  readonly identity: IdentityProvider | undefined;
  readonly clock: () => Date;
}

/** What a company reconcile did: the provider's counts, the local changes, and the removals it queued. */
export interface CompanySync {
  /** `pending` while the company has no organization at the provider yet (nothing to reconcile). */
  readonly organization: 'linked' | 'pending';
  readonly members: number;
  readonly invitations: number;
  /** Local memberships the provider no longer has, removed here. */
  readonly removed: number;
  /** Projected changes that changed something (not the ignored, deferred or refused notes). */
  readonly changed: number;
  /** Refused provider memberships newly queued for removal at the provider. */
  readonly providerRemovals: number;
}

const NOTES: ReadonlySet<ProjectionChange['action']> = new Set(['ignored', 'deferred', 'refused']);
/** The statuses of an invitation whose acceptance is refused and undone at the provider. */
const NOT_HONOURED: ReadonlySet<string> = new Set(['revoked', 'expired', 'failed']);

function providerOf(identity: IdentityProvider | undefined): IdentityProvider {
  if (identity === undefined) throw new Error('No identity provider is configured (MWC_IDENTITY=none)');
  return identity;
}

/**
 * The provider memberships among `listed` (all in the company's organization) that came from an invitation of this
 * company that is revoked, expired or failed here, by `mwc_invitation_id` or the provider's invitation id (never by
 * email), of people who are not active members here: each must go at the provider.
 */
async function refusedMembers(
  store: IdentityStore,
  issuer: string,
  companyId: string,
  listed: readonly ExternalMembership[],
): Promise<ProviderRemoval[]> {
  const removals: ProviderRemoval[] = [];
  for (const membership of listed) {
    const metadataId = membership.metadata[IDENTITY_METADATA.invitationId];
    const external = membership.externalInvitationId;
    const invitation =
      (typeof metadataId === 'string' ? await store.getInvitation(metadataId) : undefined) ??
      (external === undefined ? undefined : await store.getInvitationByExternalId(external));
    if (invitation?.companyId !== companyId || !NOT_HONOURED.has(invitation.status)) continue;
    const user = await store.getUser(issuer, membership.subject);
    const local = user === undefined ? undefined : await store.getMembership(companyId, user.id);
    if (local?.status === 'active') continue;
    const { subject, externalMembershipId } = membership;
    removals.push({ subject, externalMembershipId, invitationId: invitation.id });
  }
  return removals;
}

/** Copies the provider's members into `into` as they are listed. */
async function* recorded(members: AsyncIterable<ExternalMembership>, into: ExternalMembership[]) {
  for await (const membership of members) {
    into.push(membership);
    yield membership;
  }
}

/** A provider invitation a resend replaced and the provider revoked for us: not about the invitation it names. */
const replacedCopy = (invitation: ExternalInvitation, replaced: ReadonlySet<string>) =>
  invitation.status === 'revoked' && replaced.has(invitation.externalId);

/**
 * The provider as a company reconcile sees it: the members it lists are recorded in `listed`, and the copies our
 * resends replaced are left out of its invitations. Everything else is the provider itself.
 */
function observed(
  provider: IdentityProvider,
  listed: ExternalMembership[],
  replaced: ReadonlySet<string>,
): IdentityProvider {
  return new Proxy(provider, {
    get(target, key) {
      if (key === 'listOrganizationMembers') {
        return (orgExternalId: string) => recorded(target.listOrganizationMembers(orgExternalId), listed);
      }
      if (key === 'listInvitations') {
        return async (...args: Parameters<IdentityProvider['listInvitations']>) =>
          (await target.listInvitations(...args)).filter((invitation) => !replacedCopy(invitation, replaced));
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Brings one company in line with its organization (`reconcileOrganization` of identity-core: parked events, every
 * member, accepted and revoked invitations, memberships the provider no longer has), writes the audit rows of what it
 * changed (by the system, with `requestId`: Sync now's request, none for the periodic reconcile), then queues the
 * removal of the provider memberships it refused. `organization: 'pending'` while the company has no organization
 * yet; a company that is gone or deleted rejects with `CompanyNotFoundError`, as `tenant()` does. A provider failure
 * rejects too (what was projected before it stays, without audit rows: every step is idempotent).
 */
export async function reconcileCompany(
  deps: SyncDeps,
  companyId: string,
  requestId: string | null = null,
): Promise<CompanySync> {
  const provider = providerOf(deps.identity);
  const store = dbIdentityStore(deps.db, { provider: provider.kind, now: deps.clock });
  const company = await store.getCompany(companyId);
  if (company === undefined || company.status === 'deleted') throw new CompanyNotFoundError(companyId);
  const orgExternalId = company.identityOrgExternalId;
  if (orgExternalId === null) {
    return {
      organization: 'pending',
      members: 0,
      invitations: 0,
      removed: 0,
      changed: 0,
      providerRemovals: 0,
    };
  }
  const listed: ExternalMembership[] = [];
  const view = observed(provider, listed, await replacedInvitations(deps.db, companyId));
  const summary = await reconcileOrganization(orgExternalId, view, store, { now: deps.clock });
  await store.audit(summary.changes, requestId);
  const removals = await refusedMembers(store, provider.issuer, companyId, listed);
  return {
    organization: 'linked',
    members: summary.members,
    invitations: summary.invitations,
    removed: summary.removed,
    changed: summary.changes.filter((change) => !NOTES.has(change.action)).length,
    providerRemovals: await queueProviderRemovals(deps.db, companyId, removals),
  };
}

/**
 * Projects one normalized event (a verified webhook delivery; the inbox dedupes deliveries before calling this) in one
 * transaction, with the audit rows of what it changed in memberships and invitations (by the system, the event's id
 * as the request id), and returns what changed. The revocation of a copy one of our resends replaced is ignored. A
 * provider membership that came from an invitation we no longer honour is then queued for removal at the provider.
 */
export async function projectIdentityEvent(
  deps: SyncDeps,
  event: NormalizedIdentityEvent,
): Promise<ProjectionChange[]> {
  const provider = providerOf(deps.identity);
  const store = dbIdentityStore(deps.db, { provider: provider.kind, now: deps.clock });
  if (event.type === 'invitation.revoked') {
    const company = await store.getCompanyByOrgExternalId(event.data.orgExternalId);
    if (company && replacedCopy(event.data, await replacedInvitations(deps.db, company.id))) {
      const reason = 'replaced_provider_invitation';
      const on = { id: null, companyId: company.id, fields: [], eventId: event.externalEventId };
      return [{ entity: 'invitation', action: 'ignored', reason, ...on }];
    }
  }
  const changes = await store.transaction(async (tx) => {
    const projected = await project(event, tx, projectionContext(provider));
    await tx.audit(projected, event.externalEventId);
    return projected;
  });
  if (event.type === 'membership.upserted') {
    const company = await store.getCompanyByOrgExternalId(event.data.orgExternalId);
    if (company !== undefined) {
      const removals = await refusedMembers(store, provider.issuer, company.id, [event.data]);
      await queueProviderRemovals(deps.db, company.id, removals);
    }
  }
  return changes;
}
