import { type Invitation, invitations, isUuid } from '@mwc/db';
import type { RawDb } from '@mwc/db/system';
import type { InvitationPatch, StoredInvitation } from '@mwc/identity-core';
import { eq } from 'drizzle-orm';

/** Invitations as the projector reads and marks them, in any company. */

function stored(row: Invitation): StoredInvitation {
  return {
    id: row.id,
    companyId: row.companyId,
    email: row.emailNormalized,
    role: row.role,
    status: row.status,
    externalInvitationId: row.externalInvitationId,
    acceptedByUserId: row.acceptedByUserId,
  };
}

export async function getInvitation(db: RawDb, id: string): Promise<StoredInvitation | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db.select().from(invitations).where(eq(invitations.id, id));
  return row && stored(row);
}

export async function getInvitationByExternalId(
  db: RawDb,
  externalInvitationId: string,
): Promise<StoredInvitation | undefined> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.externalInvitationId, externalInvitationId));
  return row && stored(row);
}

/** Sets the patched fields (their names are the columns'); rejects for an invitation that does not exist. */
export async function updateInvitation(
  db: RawDb,
  id: string,
  patch: InvitationPatch,
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
  return stored(row);
}
