import { identityMarks, identityParkedEvents } from '@mwc/db';
import type { RawDb } from '@mwc/db/system';
import type { IdentityMark } from '@mwc/identity-core';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { eq } from 'drizzle-orm';

/** The projector's ordering marks and parked events (`identity_marks`, `identity_parked_events`). */

export async function getMark(db: RawDb, key: string): Promise<IdentityMark | undefined> {
  const [row] = await db
    .select({ at: identityMarks.providerUpdatedAtMs, deleted: identityMarks.deleted })
    .from(identityMarks)
    .where(eq(identityMarks.key, key));
  return row;
}

export async function setMark(db: RawDb, key: string, mark: IdentityMark): Promise<void> {
  const values = { providerUpdatedAtMs: mark.at, deleted: mark.deleted };
  await db
    .insert(identityMarks)
    .values({ key, ...values })
    .onConflictDoUpdate({ target: identityMarks.key, set: { ...values, updatedAt: new Date() } });
}

/** Parks an event under a key; the same event (by delivery id) under the same key is kept once. */
export async function defer(db: RawDb, key: string, event: NormalizedIdentityEvent): Promise<void> {
  await db
    .insert(identityParkedEvents)
    .values({ key, externalEventId: event.externalEventId, event })
    .onConflictDoNothing();
}

/** Removes the events parked under a key and returns them in parking order. */
export async function takeDeferred(db: RawDb, key: string): Promise<NormalizedIdentityEvent[]> {
  const rows = await db.delete(identityParkedEvents).where(eq(identityParkedEvents.key, key)).returning();
  return rows.sort((a, b) => a.id - b.id).map((row) => row.event);
}
