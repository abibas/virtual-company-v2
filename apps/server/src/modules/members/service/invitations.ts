import { type DbHandle, diffFields, type Invitation, type TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { invitationStatusAt } from '@mwc/shared/identity';
import { newId } from '@mwc/shared/ids';
import { enqueueOutbox, outboxKey } from '../../../platform/jobs/outbox.ts';
import { profilesOf } from '../../identity/service.ts';
import type { MembersRepo } from '../repo.ts';
import {
  ALREADY_MEMBER,
  INVITATION_NOT_FOUND,
  INVITATION_NOT_PENDING,
  INVITATION_PENDING,
  invitationExpiry,
  inviteRefusal,
  NOT_ACTIVE,
  normalizeEmail,
  type Refusal,
} from '../rules.ts';

/**
 * Invitations, local first: each change lands in one transaction under the company's lock (the acting member's
 * membership read again there, as for role changes), with its audit rows and the outbox call that makes the identity
 * provider follow (`invite`, `revoke_invite`; `service/invitation-provider.ts` handles them).
 */

export interface InvitationCall {
  /** The acting member's membership; the rest of it is read again under the company's lock. */
  readonly actorId: string;
  readonly requestId: string;
  readonly now: Date;
}

/** What the provider sends: the emailed link lands on `<MWC_WEB_ORIGIN>/accept-invitation`. */
interface Sending {
  readonly redirectUrl: string;
}

export interface NewInvitation extends InvitationCall, Sending {
  readonly email: string;
  readonly role: MembershipRole;
}

export interface InvitationChange extends InvitationCall {
  readonly invitationId: string;
}

export interface Resend extends InvitationChange, Sending {}

export type InvitationResult = { readonly ok: true; readonly invitation: Invitation } | Refusal;

/** The invitation fields an audit row reports when it is created. */
const audited = (row: Invitation) => ({
  email: row.emailNormalized,
  expiresAt: row.expiresAt,
  role: row.role,
  status: row.status,
});

const byUser = (actorPrincipalId: string, requestId: string) =>
  ({ actorKind: 'user', actorPrincipalId, requestId }) as const;

/**
 * The emails of everyone the member list shows (any membership that is not removed). People are global rows, read
 * through the identity module on the database handle, so this runs before the transaction: with one connection
 * (PGlite) a read beside an open transaction would wait for it.
 */
async function memberEmails(db: DbHandle, repo: MembersRepo, t: TenantDb): Promise<Set<string>> {
  const rows = await repo.list(t);
  const profiles = await profilesOf(
    db,
    rows.map((row) => row.userId),
  );
  return new Set([...profiles.values()].map((profile) => profile.primaryEmail));
}

/** Stores `expired` on the company's overdue pending invitations (a system change, audited), so the email is free. */
async function expireOverdue(repo: MembersRepo, t: TenantDb, now: Date) {
  const expired = await repo.expireOverdue(t, now);
  for (const row of expired.sort((a, b) => a.id.localeCompare(b.id))) {
    await repo.audit(t, {
      actorKind: 'system',
      entityType: 'invitation',
      entityId: row.id,
      action: 'expire',
      changes: diffFields({ status: 'pending' }, { status: row.status }),
    });
  }
}

/**
 * `POST .../invitations`: invites an email with a role. Under the company's lock: the acting member must still be
 * active (403), an admin may not invite an owner (403), a member's email (read just before) is a 409 `already_member`,
 * and an email with a pending invitation a 409 `invitation_pending` (overdue ones are stored as expired first, so
 * they do not count).
 * Then the invitation (pending, expiring in 14 days) with its audit rows and the outbox `invite` call. Every
 * invitation change of a company runs under its lock, so the one-pending-per-email index is never what refuses.
 */
export async function createInvitation(
  db: DbHandle,
  repo: MembersRepo,
  t: TenantDb,
  call: NewInvitation,
): Promise<InvitationResult> {
  const email = normalizeEmail(call.email);
  const members = await memberEmails(db, repo, t);
  return t.transaction(async (tx) => {
    const actor = await repo.lockedActor(tx, call.actorId);
    if (actor?.status !== 'active') return NOT_ACTIVE;
    const refusal = inviteRefusal(actor.role, call.role);
    if (refusal) return refusal;
    if (members.has(email)) return ALREADY_MEMBER;
    await expireOverdue(repo, tx, call.now);
    if (await repo.pendingFor(tx, email)) return INVITATION_PENDING;
    const invitation = await repo.insertInvitation(tx, {
      emailNormalized: email,
      role: call.role,
      expiresAt: invitationExpiry(call.now),
      invitedByPrincipalId: actor.principalId,
    });
    await repo.audit(tx, {
      ...byUser(actor.principalId, call.requestId),
      entityType: 'invitation',
      entityId: invitation.id,
      action: 'create',
      changes: diffFields(null, audited(invitation)),
    });
    await enqueueOutbox(tx, {
      op: 'invite',
      idempotencyKey: outboxKey('invite', invitation.id),
      payload: { invitationId: invitation.id, redirectUrl: call.redirectUrl },
    });
    return { ok: true as const, invitation };
  });
}

/**
 * The acting member and the invitation a resend or a revoke changes, read under the company's lock, or why it
 * stops: the actor is no longer active (403), the invitation is unknown (404), or the role rules refuse it (403: an
 * admin does not touch an owner's invitation).
 */
async function lockedInvitation(repo: MembersRepo, t: TenantDb, call: InvitationChange) {
  const actor = await repo.lockedActor(t, call.actorId);
  if (actor?.status !== 'active') return NOT_ACTIVE;
  const invitation = await repo.getInvitation(t, call.invitationId);
  if (invitation === undefined) return INVITATION_NOT_FOUND;
  return inviteRefusal(actor.role, invitation.role) ?? { actor, invitation };
}

/**
 * `POST .../invitations/:id/resend`: a pending invitation only (409 otherwise, an overdue one included). It expires
 * 14 days from now again and forgets the provider invitation it followed; the outbox `invite` call (a new key per
 * resend) revokes that one at the provider (`replaces`) and sends a new one with the same metadata, so the link to
 * this invitation stays ours.
 */
export function resendInvitation(repo: MembersRepo, t: TenantDb, call: Resend): Promise<InvitationResult> {
  return t.transaction(async (tx) => {
    const found = await lockedInvitation(repo, tx, call);
    if ('ok' in found) return found;
    const { actor, invitation } = found;
    if (invitationStatusAt(invitation.status, invitation.expiresAt, call.now) !== 'pending') {
      return INVITATION_NOT_PENDING;
    }
    const after = await repo.updateInvitation(tx, invitation.id, {
      expiresAt: invitationExpiry(call.now),
      externalInvitationId: null,
    });
    await repo.audit(tx, {
      ...byUser(actor.principalId, call.requestId),
      entityType: 'invitation',
      entityId: invitation.id,
      action: 'resend',
      changes: diffFields({ expiresAt: invitation.expiresAt }, { expiresAt: after.expiresAt }),
    });
    await enqueueOutbox(tx, {
      op: 'invite',
      idempotencyKey: outboxKey('invite', invitation.id, newId()),
      payload: {
        invitationId: invitation.id,
        replaces: invitation.externalInvitationId,
        redirectUrl: call.redirectUrl,
      },
    });
    return { ok: true as const, invitation: after };
  });
}

/**
 * `DELETE .../invitations/:id`: revokes a pending invitation, local first (`revoked`: an acceptance from now on is
 * refused and undone at the provider), then the outbox `revoke_invite` call. One already revoked is a success that
 * writes nothing; any other status (an overdue one included) is a 409.
 */
export function revokeInvitation(
  repo: MembersRepo,
  t: TenantDb,
  call: InvitationChange,
): Promise<InvitationResult> {
  return t.transaction(async (tx) => {
    const found = await lockedInvitation(repo, tx, call);
    if ('ok' in found) return found;
    const { actor, invitation } = found;
    if (invitation.status === 'revoked') return { ok: true as const, invitation };
    if (invitationStatusAt(invitation.status, invitation.expiresAt, call.now) !== 'pending') {
      return INVITATION_NOT_PENDING;
    }
    const after = await repo.updateInvitation(tx, invitation.id, { status: 'revoked' });
    await repo.audit(tx, {
      ...byUser(actor.principalId, call.requestId),
      entityType: 'invitation',
      entityId: invitation.id,
      action: 'revoke',
      changes: diffFields({ status: invitation.status }, { status: after.status }),
    });
    await enqueueOutbox(tx, {
      op: 'revoke_invite',
      idempotencyKey: outboxKey('revoke_invite', invitation.id),
      payload: { invitationId: invitation.id },
    });
    return { ok: true as const, invitation: after };
  });
}
