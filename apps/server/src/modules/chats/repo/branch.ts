import { chatEvents, chatTurns, type TenantDb } from '@mwc/db';
import type { TurnEvent } from '@mwc/shared/harness';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { BranchMarker } from '../rules/branch.ts';

/** What a branch reads of its parent (`rules/branch.ts`), through the company's tenant only. */

/** The event types that decide a branch: a turn's session, a compaction, its result (the last message id). */
const MARKERS = ['session', 'compact', 'result'] as const;

/** The markers of the chat's turns from `fromSeq` on (the reply's turn, so never none), in order. */
async function markersFrom(t: TenantDb, chatId: string, fromSeq: number): Promise<BranchMarker[]> {
  const turns = await t
    .selectFields(
      chatTurns,
      { id: chatTurns.id, kind: chatTurns.kind },
      and(eq(chatTurns.chatId, chatId), gte(chatTurns.seq, fromSeq)),
    )
    .orderBy(asc(chatTurns.seq));
  const kinds = new Map(turns.map((turn) => [turn.id, turn.kind]));
  const events = await t
    .selectFields(
      chatEvents,
      { turnId: chatEvents.turnId, event: chatEvents.event },
      and(
        inArray(chatEvents.turnId, [...kinds.keys()]),
        inArray(sql`${chatEvents.event}->>'type'`, [...MARKERS]),
      ),
    )
    .orderBy(asc(chatEvents.seq));
  const order = [...kinds.keys()];
  return events
    .sort((a, b) => order.indexOf(a.turnId) - order.indexOf(b.turnId))
    .map((row) => ({
      turnId: row.turnId,
      kind: kinds.get(row.turnId) as BranchMarker['kind'],
      event: row.event as TurnEvent,
    }));
}

export const branchRepo = { markersFrom };
