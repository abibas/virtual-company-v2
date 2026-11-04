import { type Invitation, identityOutbox, invitations, isUuid } from '@mwc/db';
import type { RawDb } from '@mwc/db/system';
import type { InvitationPatch, StoredInvitation } from '@mwc/identity-core';
import { invitationStatusAt } from '@mwc/shared/identity';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Invitations as the projector reads and marks them, in any company. A pending invitation past its expiry reads as
 * `expired` (as of `now`), so the projector refuses a membership that comes from it on every path (webhook, sign-in,
 * reconcile) even before anything has stored the expiry.
 */

function stored(row: Invitation, now: Date): StoredInvitation {
  return {
    id: row.id,
    companyId: row.companyId,
    email: row.emailNormalized,
    role: row.role,
    status: invitationStatusAt(row.status, row.expiresAt, now),
    externalInvitationId: row.externalInvitationId,
    acceptedByUserId: row.acceptedByUserId,
  };
}

export async function getInvitation(db: RawDb, id: string, now: Date): Promise<StoredInvitation | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db.select().from(invitations).where(eq(invitations.id, id));
  return row && stored(row, now);
}

export async function getInvitationByExternalId(
  db: RawDb,
  externalInvitationId: string,
  now: Date,
): Promise<StoredInvitation | undefined> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.externalInvitationId, externalInvitationId));
  return row && stored(row, now);
}

/** Sets the patched fields (their names are the columns'); rejects for an invitation that does not exist. */
export async function updateInvitation(
  db: RawDb,
  id: string,
  patch: InvitationPatch,
  now: Date,
): Promise<StoredInvitation> {
  let row: Invitation | undefined;
  if (isUuid(id)) {
    const where = eq(invitations.id, id);
    [row] =
      Object.keys(patch).length === 0
        ? await db.select().from(invitations).where(where)
        : await db.update(invitations).set(patch).where(where).returning();
  }
  if (!row) throw new Error(`no invitation ${id}`);
  return stored(row, now);
}

/**
 * The provider invitations a resend replaced in this company (the `replaces` of its `invite` outbox rows): the
 * provider revokes them on our behalf, so their revocation is not about the invitation they link back to.
 */
export async function replacedExternalIds(db: RawDb, companyId: string): Promise<Set<string>> {
  const replaces = sql<string>`${identityOutbox.payload} ->> 'replaces'`;
  const rows = await db
    .select({ replaces })
    .from(identityOutbox)
    .where(
      and(
        eq(identityOutbox.companyId, companyId),
        eq(identityOutbox.op, 'invite'),
        sql`${identityOutbox.payload} ->> 'replaces' is not null`,
      ),
    );
  return new Set(rows.map((row) => row.replaces));
}
