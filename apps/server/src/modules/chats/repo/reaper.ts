import { type ChatTurn, chatTurns, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, eq, inArray, lt, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

/**
 * The turns a stopped server left live, across every company (S5.1b, S5.4): the one place the chats module reads and
 * writes without a tenant, listed in biome.json's exemption, since at a start any company's turns may be left. A running
 * turn outlives the server (its runner keeps it and takes it back to the next server), so at a start only the waiting
 * turns of chats with nothing running fail; the running ones are read again once the grace is over.
 */

/** A turn the reaper failed or found left running: its company, chat and kind (a task's conversation hears of it). */
export interface ReapedTurn {
  readonly id: string;
  readonly companyId: string;
  readonly chatId: string;
  readonly kind: ChatTurn['kind'];
}

const reaped = {
  id: chatTurns.id,
  companyId: chatTurns.companyId,
  chatId: chatTurns.chatId,
  kind: chatTurns.kind,
};

/** Fails every queued turn whose chat has no running turn with `error`, ended at `now`; returns them. */
export function failWaitingTurns(db: DbHandle, now: Date, error: string): Promise<ReapedTurn[]> {
  const running = alias(chatTurns, 'running');
  const raw = rawDb(db);
  const runningOfChat = raw
    .select({ id: running.id })
    .from(running)
    .where(and(eq(running.chatId, chatTurns.chatId), eq(running.status, 'running')));
  return raw
    .update(chatTurns)
    .set({ status: 'failed', error, endedAt: now })
    .where(and(inArray(chatTurns.status, ['queued']), notExists(runningOfChat)))
    .returning(reaped);
}

/** The turns still running that started before `before` (a stopped server's). */
export function runningSince(db: DbHandle, before: Date): Promise<ReapedTurn[]> {
  return rawDb(db)
    .select(reaped)
    .from(chatTurns)
    .where(and(eq(chatTurns.status, 'running'), lt(chatTurns.startedAt, before)));
}
