import { type ChatTurn, chatTurns, type TenantDb, type TenantSet } from '@mwc/db';
import { and, asc, eq, max, ne } from 'drizzle-orm';

/**
 * A chat's queue (S5.2 step 6, docs/harness.md "Delivery while a turn runs"): the turn that runs, the ones waiting
 * behind it, and the changes a waiting one takes (its prompt, its delivery, its start or its end) only while it still
 * waits, through the company's tenant only.
 */

/** The chat's running turn, if one runs. */
async function runningOf(t: TenantDb, chatId: string): Promise<ChatTurn | undefined> {
  const [row] = await t.select(chatTurns, and(eq(chatTurns.chatId, chatId), eq(chatTurns.status, 'running')));
  return row;
}

/** The chat's waiting turns, by number (`queueOrder` puts them in the order they start). */
const queuedOf = (t: TenantDb, chatId: string): Promise<ChatTurn[]> =>
  t
    .select(chatTurns, and(eq(chatTurns.chatId, chatId), eq(chatTurns.status, 'queued')))
    .orderBy(asc(chatTurns.seq));

/** The highest number of a turn that started (not waiting), 0 before any. */
async function lastStartedSeq(t: TenantDb, chatId: string): Promise<number> {
  const where = and(eq(chatTurns.chatId, chatId), ne(chatTurns.status, 'queued'));
  const [row] = await t.selectFields(chatTurns, { seq: max(chatTurns.seq) }, where);
  return row?.seq ?? 0;
}

/**
 * Changes a turn of the chat while it waits (by the id of a row read first, or a UUID a frame carried); undefined when
 * it does not wait (it started, ended or is gone).
 */
async function updateQueued(
  t: TenantDb,
  chatId: string,
  id: string,
  set: TenantSet<typeof chatTurns>,
): Promise<ChatTurn | undefined> {
  const where = and(eq(chatTurns.chatId, chatId), eq(chatTurns.id, id), eq(chatTurns.status, 'queued'));
  const [row] = await t.update(chatTurns, set, where).returning();
  return row;
}

/** Removes a turn of the chat while it waits (it has no events yet; ids as above); undefined when it does not wait. */
async function deleteQueued(t: TenantDb, chatId: string, id: string): Promise<ChatTurn | undefined> {
  const where = and(eq(chatTurns.chatId, chatId), eq(chatTurns.id, id), eq(chatTurns.status, 'queued'));
  const [row] = await t.delete(chatTurns, where).returning();
  return row;
}

export const queueRepo = { runningOf, queuedOf, lastStartedSeq, updateQueued, deleteQueued };
