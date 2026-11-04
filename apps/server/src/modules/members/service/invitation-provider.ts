import { type DbHandle, diffFields, type IdentityOutboxRow, type Invitation, type TenantDb } from '@mwc/db';
import { type IdentityProvider, isIdentityProviderError } from '@mwc/identity-core';
import { type ExternalInvitation, IDENTITY_METADATA, invitationStatusAt } from '@mwc/shared/identity';
import {
  isLastAttempt,
  OutboxGiveUpError,
  type OutboxHandler,
  type OutboxHandlers,
  outboxProvider,
  outboxTenant,
} from '../../../platform/jobs/outbox.ts';
import { membersRepo } from '../repo.ts';
import { daysLeft } from '../rules.ts';
import { OrganizationPendingError } from './provider.ts';

/**
 * An invitation at the identity provider: the `invite` and `revoke_invite` outbox handlers, which the jobs loop
 * (S1.10) calls through `processOutboxRow` (`platform/jobs/outbox.ts`). The provider's invitations of ours carry our
 * invitation's id in their private metadata (`mwc_invitation_id`, with `mwc_company_id`), and each handler looks for
 * them by it before acting, so a retry after the provider acted (an answer lost on the way back) never sends a second
 * email or leaves a copy pending.
 */

export interface InvitationSyncDeps {
  readonly db: DbHandle;
  readonly identity: IdentityProvider | undefined;
  readonly clock: () => Date;
}

/** The invitation a row names (`payload.invitationId`) in the row's company, if it still exists. */
function invitationOf(t: TenantDb, row: IdentityOutboxRow): Promise<Invitation | undefined> {
  const id = row.payload.invitationId;
  return typeof id === 'string' ? membersRepo().getInvitation(t, id) : Promise.resolve(undefined);
}

interface InvitationAtProvider {
  readonly provider: IdentityProvider;
  readonly t: TenantDb;
  readonly invitation: Invitation;
  readonly orgExternalId: string;
}

/**
 * The invitation a row names (`payload.invitationId`) and its company's organization, or undefined when there is
 * nothing to do (the company is deleted, or the invitation gone). Rejects with `OrganizationPendingError` while the
 * organization is not created yet, so the row waits for its `create_org`.
 */
async function invitationAtProvider(
  deps: InvitationSyncDeps,
  row: IdentityOutboxRow,
): Promise<InvitationAtProvider | undefined> {
  const provider = outboxProvider(deps.identity);
  const t = await outboxTenant(deps.db, row.companyId);
  if (t === undefined) return undefined;
  const invitation = await invitationOf(t, row);
  if (invitation === undefined) return undefined;
  const orgExternalId = t.company.identityOrgId;
  if (orgExternalId === null) throw new OrganizationPendingError(t.companyId);
  return { provider, t, invitation, orgExternalId };
}

/** The provider's invitations that are copies of ours: our invitation's id in their metadata. */
const copiesOf = (list: readonly ExternalInvitation[], invitationId: string) =>
  list.filter((copy) => copy.metadata[IDENTITY_METADATA.invitationId] === invitationId);

/** Sends the invitation: our metadata, its role, the days it has left, the emailed link's landing page. */
function send(found: InvitationAtProvider, row: IdentityOutboxRow, now: Date) {
  const { provider, invitation, orgExternalId } = found;
  const redirectUrl = row.payload.redirectUrl;
  return provider.createInvitation({
    orgExternalId,
    email: invitation.emailNormalized,
    role: invitation.role,
    metadata: {
      [IDENTITY_METADATA.invitationId]: invitation.id,
      [IDENTITY_METADATA.companyId]: invitation.companyId,
    },
    expiresInDays: daysLeft(invitation.expiresAt, now),
    ...(typeof redirectUrl === 'string' ? { redirectUrl } : {}),
  });
}

/**
 * Sends a pending invitation once. Nothing to do when it is no longer pending (revoked, accepted or expired since),
 * or already follows a provider invitation (an earlier try, or another row, sent it). Otherwise the provider's copies
 * of it decide: one accepted means the person is in (the projection follows), the copy a resend replaces
 * (`payload.replaces`) is revoked first, and a pending copy that is not that one is adopted instead of sending again;
 * only when there is none is a new one sent. The provider invitation it follows is then stored.
 */
async function deliver(deps: InvitationSyncDeps, row: IdentityOutboxRow): Promise<void> {
  const found = await invitationAtProvider(deps, row);
  if (found === undefined) return;
  const { provider, t, invitation, orgExternalId } = found;
  const now = deps.clock();
  if (invitation.externalInvitationId !== null) return;
  if (invitationStatusAt(invitation.status, invitation.expiresAt, now) !== 'pending') return;
  const replaces = typeof row.payload.replaces === 'string' ? row.payload.replaces : null;
  const copies = copiesOf(await provider.listInvitations(orgExternalId), invitation.id);
  if (copies.some((copy) => copy.status === 'accepted')) return;
  const pending = copies.filter((copy) => copy.status === 'pending');
  if (pending.some((copy) => copy.externalId === replaces)) {
    await provider.revokeInvitation(orgExternalId, replaces as string);
  }
  const sent = pending.find((copy) => copy.externalId !== replaces) ?? (await send(found, row, now));
  await membersRepo().updateInvitation(t, invitation.id, { externalInvitationId: sent.externalId });
}

/** The invitation turns `failed` (local only: the provider never sent it), audited as a system change. */
async function markFailed(deps: InvitationSyncDeps, row: IdentityOutboxRow): Promise<void> {
  const t = await outboxTenant(deps.db, row.companyId);
  const invitation = t === undefined ? undefined : await invitationOf(t, row);
  if (t === undefined || invitation?.status !== 'pending') return;
  const repo = membersRepo();
  const after = await repo.updateInvitation(t, invitation.id, { status: 'failed' });
  await repo.audit(t, {
    actorKind: 'system',
    entityType: 'invitation',
    entityId: invitation.id,
    action: 'fail',
    changes: diffFields({ status: invitation.status }, { status: after.status }),
  });
}

/**
 * `invite`, and the provider side of a resend (`deliver`). A provider that refuses the invitation for good (`invalid`:
 * a malformed request, or a limit such as the members an organization may have, which surfaces as the provider's own
 * error) fails the row at once with that error as `last_error` and the invitation `failed`; so does the last allowed
 * try of any other failure. Until then a failure is tried again later (a conflict too: the person may still be a
 * member there until their `remove_member` runs).
 */
export function inviteHandler(deps: InvitationSyncDeps): OutboxHandler {
  return async (row) => {
    try {
      await deliver(deps, row);
    } catch (error) {
      const refused = isIdentityProviderError(error, 'invalid');
      if (refused || isLastAttempt(row)) await markFailed(deps, row);
      throw refused ? new OutboxGiveUpError(error) : error;
    }
  };
}

/** Revokes one provider invitation; one accepted, expired or gone meanwhile is as good as revoked. */
async function revokeCopy(provider: IdentityProvider, orgExternalId: string, externalId: string) {
  try {
    await provider.revokeInvitation(orgExternalId, externalId);
  } catch (error) {
    if (!isIdentityProviderError(error, 'conflict') && !isIdentityProviderError(error, 'not_found'))
      throw error;
  }
}

/**
 * `revoke_invite`: revokes the provider invitation the revoked invitation follows and every pending copy of it the
 * provider has (one sent by a try whose answer was lost), so nothing of it stays acceptable there. A copy accepted
 * meanwhile counts as done: the projection refuses that acceptance and the provider membership is removed.
 */
export function revokeInviteHandler(deps: InvitationSyncDeps): OutboxHandler {
  return async (row) => {
    const found = await invitationAtProvider(deps, row);
    if (found === undefined || found.invitation.status !== 'revoked') return;
    const { provider, invitation, orgExternalId } = found;
    const pending = copiesOf(await provider.listInvitations(orgExternalId, 'pending'), invitation.id);
    const targets = new Set(pending.map((copy) => copy.externalId));
    if (invitation.externalInvitationId !== null) targets.add(invitation.externalInvitationId);
    for (const externalId of targets) await revokeCopy(provider, orgExternalId, externalId);
  };
}

/** The invitations' outbox handlers, by op, for the jobs loop. */
export function invitationOutboxHandlers(deps: InvitationSyncDeps): OutboxHandlers {
  return { invite: inviteHandler(deps), revoke_invite: revokeInviteHandler(deps) };
}
