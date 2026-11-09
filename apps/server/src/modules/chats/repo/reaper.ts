import { chatTurns, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { inArray } from 'drizzle-orm';

/**
 * The turns a stopped server left live, across every company (S5.1b): the one place the chats module writes without a
 * tenant, listed in biome.json's exemption, since at a start any company's turns may be left. A turn lives only while
 * the server that started it keeps its runner's connection, so after a restart none of them can end by itself.
 */

/** Fails every queued or running turn with `error`, ended at `now`; returns how many. */
export async function failLiveTurns(db: DbHandle, now: Date, error: string): Promise<number> {
  const rows = await rawDb(db)
    .update(chatTurns)
    .set({ status: 'failed', error, endedAt: now })
    .where(inArray(chatTurns.status, ['queued', 'running']))
    .returning({ id: chatTurns.id });
  return rows.length;
}
