import type { DbHandle, IdentityOutboxRow, Membership } from '@mwc/db';
import { type IdentityProvider, isIdentityProviderError } from '@mwc/identity-core';
import {
  enqueueOutbox,
  type OutboxHandler,
  type OutboxHandlers,
  outboxKey,
  outboxProvider,
  outboxTenant,
} from '../../../platform/jobs/outbox.ts';
import { subjectOf, userOfSubject } from '../../identity/service.ts';
import { membersRepo } from '../repo.ts';

/**
 * A member at the identity provider: the `update_role` and `remove_member` outbox handlers, which the jobs loop
 * (S1.10) calls through `processOutboxRow` (`platform/jobs/outbox.ts`). Each pushes the membership as it is when it
 * runs, not as it was when the call was enqueued, so rows run late, twice or out of order converge on the latest
 * local state; a member the provider no longer has counts as done. `remove_member` also removes a provider
 * membership this product refused (`queueProviderRemovals`): one that came from an invitation revoked, expired or
 * failed here.
 */

export interface MemberSyncDeps {
  readonly db: DbHandle;
  readonly identity: IdentityProvider | undefined;
}

/** The company has no organization at the provider yet (its create_org has not run): the call waits for it. */
export class OrganizationPendingError extends Error {
  constructor(companyId: string) {
    super(`company ${companyId} has no organization at the identity provider yet; trying again later`);
    this.name = 'OrganizationPendingError';
  }
}

interface MemberAtProvider {
  readonly provider: IdentityProvider;
  readonly orgExternalId: string;
  readonly subject: string;
  readonly membership: Membership;
}

/**
 * What a member call acts on, as things are now: the membership the row names (`payload.membershipId`), the company's
 * organization and the person's subject at the provider. Undefined when there is nothing to do: the company is
 * deleted (its delete_org removes the organization), the membership is gone or not in the state `due` wants, or the
 * person has no identity at this provider. Rejects with `OrganizationPendingError` while the organization is not
 * created yet, so the row is tried again later (never marked done before the provider has the change).
 */
async function memberAtProvider(
  deps: MemberSyncDeps,
  row: IdentityOutboxRow,
  due: (membership: Membership) => boolean,
): Promise<MemberAtProvider | undefined> {
  const provider = outboxProvider(deps.identity);
  const t = await outboxTenant(deps.db, row.companyId);
  if (t === undefined) return undefined;
  const id = row.payload.membershipId;
  const membership = typeof id === 'string' ? await membersRepo().get(t, id) : undefined;
  if (membership === undefined || !due(membership)) return undefined;
  const orgExternalId = t.company.identityOrgId;
  if (orgExternalId === null) throw new OrganizationPendingError(t.companyId);
  const subject = await subjectOf(deps.db, membership.userId, provider.kind);
  return subject === undefined ? undefined : { provider, orgExternalId, subject, membership };
}

/** Runs a provider call for which `not_found` (the member or the organization is gone) means done. */
async function goneIsDone(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!isIdentityProviderError(error, 'not_found')) throw error;
  }
}

/**
 * `update_role`: sets the member's provider role to the role their membership has now (the provider maps it with
 * its role map: Clerk's owner and admin are `org:admin`, member and viewer `org:member`). A removed membership needs
 * nothing (its `remove_member` call follows).
 */
export function updateRoleHandler(deps: MemberSyncDeps): OutboxHandler {
  return async (row) => {
    const target = await memberAtProvider(deps, row, (membership) => membership.status !== 'removed');
    if (target === undefined) return;
    const { provider, orgExternalId, subject, membership } = target;
    await goneIsDone(() => provider.updateMemberRole(orgExternalId, subject, membership.role));
  };
}

/**
 * A provider membership this product refused: the person accepted an invitation that is revoked, expired or failed
 * here (our database wins), so they are not a member here and must not stay one at the provider.
 */
export interface ProviderRemoval {
  readonly subject: string;
  readonly externalMembershipId: string;
  readonly invitationId: string;
}

/**
 * Queues a `remove_member` call for each refused provider membership, once per provider membership (its id is the
 * key); returns how many were new. A deleted company needs none.
 */
export async function queueProviderRemovals(
  db: DbHandle,
  companyId: string,
  removals: readonly ProviderRemoval[],
): Promise<number> {
  const t = removals.length === 0 ? undefined : await outboxTenant(db, companyId);
  if (t === undefined) return 0;
  let queued = 0;
  for (const removal of removals) {
    const row = await enqueueOutbox(t, {
      op: 'remove_member',
      idempotencyKey: outboxKey('remove_member', 'provider', removal.externalMembershipId),
      payload: { ...removal },
    });
    if (row !== undefined) queued++;
  }
  return queued;
}

/**
 * `remove_member` for a refused provider membership (`payload.subject`): removes the person from the organization
 * unless they are an active member here by now (invited again and accepted since: the provider membership is then
 * theirs by right).
 */
async function removeRefused(deps: MemberSyncDeps, row: IdentityOutboxRow, subject: string): Promise<void> {
  const provider = outboxProvider(deps.identity);
  const t = await outboxTenant(deps.db, row.companyId);
  if (t === undefined) return;
  const orgExternalId = t.company.identityOrgId;
  if (orgExternalId === null) throw new OrganizationPendingError(t.companyId);
  const userId = await userOfSubject(deps.db, provider.issuer, subject);
  const membership = userId === undefined ? undefined : await membersRepo().getByUser(t, userId);
  if (membership?.status === 'active') return;
  await goneIsDone(() => provider.removeMember(orgExternalId, subject));
}

/**
 * `remove_member`: removes the person from the organization while their membership is still removed here. One that
 * is active again (invited back since) is left alone: the provider membership is then the new one. A row about a
 * refused provider membership (`payload.subject`) goes to `removeRefused`.
 */
export function removeMemberHandler(deps: MemberSyncDeps): OutboxHandler {
  return async (row) => {
    const refused = row.payload.subject;
    if (typeof refused === 'string') return removeRefused(deps, row, refused);
    const target = await memberAtProvider(deps, row, (membership) => membership.status === 'removed');
    if (target === undefined) return;
    const { provider, orgExternalId, subject } = target;
    await goneIsDone(() => provider.removeMember(orgExternalId, subject));
  };
}

/** The members module's outbox handlers, by op, for the jobs loop. */
export function memberOutboxHandlers(deps: MemberSyncDeps): OutboxHandlers {
  return { update_role: updateRoleHandler(deps), remove_member: removeMemberHandler(deps) };
}
