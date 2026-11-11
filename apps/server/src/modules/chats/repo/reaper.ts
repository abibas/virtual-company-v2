import { type ChatTurn, chatTurns, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { inArray } from 'drizzle-orm';

/**
 * The turns a stopped server left live, across every company (S5.1b): the one place the chats module writes without a
 * tenant, listed in biome.json's exemption, since at a start any company's turns may be left. A turn lives only while
 * the server that started it keeps its runner's connection, so after a restart none of them can end by itself.
 */

/** A turn the reaper failed: its company, chat and kind (a task's conversation hears of its message turns). */
export interface ReapedTurn {
  readonly id: string;
  readonly companyId: string;
  readonly chatId: string;
  readonly kind: ChatTurn['kind'];
}

/** Fails every queued or running turn with `error`, ended at `now`; returns them. */
export function failLiveTurns(db: DbHandle, now: Date, error: string): Promise<ReapedTurn[]> {
  return rawDb(db)
    .update(chatTurns)
    .set({ status: 'failed', error, endedAt: now })
    .where(inArray(chatTurns.status, ['queued', 'running']))
    .returning({
      id: chatTurns.id,
      companyId: chatTurns.companyId,
      chatId: chatTurns.chatId,
      kind: chatTurns.kind,
    });
}
