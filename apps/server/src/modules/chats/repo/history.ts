import { type ChatEvent, type ChatTurn, chatEvents, chatTurns, type TenantDb } from '@mwc/db';
import { and, asc, count, desc, eq, gte, inArray, lt, ne, type SQL, sql } from 'drizzle-orm';
import type { ClearPoint, SpanOf } from '../rules/history.ts';

/**
 * A chat's history, read a window at a time (docs/harness.md "Reading a long chat"), through the company's tenant only:
 * its Clears, the latest turns of a range, how many turns a range holds, the size and time span of each conversation
 * before a Clear, and the few events of older turns that say what the conversation runs on. All on the turns' unique
 * `(company_id, chat_id, seq)` index and the events' `(company_id, turn_id, seq)` key.
 */

/** A seq range of a chat: from `fromSeq` (inclusive) to before `beforeSeq` (exclusive, default no end). */
export interface SeqRange {
  readonly fromSeq: number;
  readonly beforeSeq?: number;
}

const inRange = (chatId: string, range: SeqRange): SQL | undefined =>
  and(
    eq(chatTurns.chatId, chatId),
    gte(chatTurns.seq, range.fromSeq),
    range.beforeSeq === undefined ? undefined : lt(chatTurns.seq, range.beforeSeq),
  );

/** The chat's Clear turns, oldest first. */
const clearsOf = (t: TenantDb, chatId: string): Promise<ClearPoint[]> =>
  t
    .selectFields(
      chatTurns,
      { id: chatTurns.id, seq: chatTurns.seq, createdAt: chatTurns.createdAt },
      and(eq(chatTurns.chatId, chatId), eq(chatTurns.kind, 'clear')),
    )
    .orderBy(asc(chatTurns.seq));

/** The latest `limit` turns of the range, in order (oldest first). */
async function latestOf(t: TenantDb, chatId: string, range: SeqRange, limit: number): Promise<ChatTurn[]> {
  const rows = await t.select(chatTurns, inRange(chatId, range)).orderBy(desc(chatTurns.seq)).limit(limit);
  return rows.reverse();
}

/** How many turns the range holds. */
async function countOf(t: TenantDb, chatId: string, range: SeqRange): Promise<number> {
  const rows = await t.selectFields(chatTurns, { n: count() }, inRange(chatId, range));
  return Number((rows[0] as { n: number }).n);
}

/**
 * The conversations before each Clear (`clearSeqs` ascending): conversation `i` is the turns before the `i`-th Clear
 * and after the one before it. One grouped query; a conversation with no turn has no row.
 */
async function spansOf(t: TenantDb, chatId: string, clearSeqs: readonly number[]): Promise<SpanOf[]> {
  const last = clearSeqs.at(-1);
  if (last === undefined) return [];
  const cases = clearSeqs.map((seq, i) => sql`when ${chatTurns.seq} < ${seq} then ${sql.raw(String(i))}`);
  const index = sql<number>`case ${sql.join(cases, sql` `)} end`;
  const where = and(eq(chatTurns.chatId, chatId), lt(chatTurns.seq, last), ne(chatTurns.kind, 'clear'));
  const rows = await t
    .selectFields(
      chatTurns,
      {
        index,
        turns: count(),
        from: sql<string>`min(${chatTurns.createdAt})`,
        to: sql<string>`max(${chatTurns.createdAt})`,
      },
      where,
    )
    .groupBy(sql`1`);
  return rows.map((row) => ({
    index: Number(row.index),
    turns: Number(row.turns),
    from: new Date(row.from),
    to: new Date(row.to),
  }));
}

/** The event types that say what a conversation runs on and how full it is (`conversationState`). */
const STATE_EVENTS = ['init', 'context', 'compact'] as const;

/** The turns of the range (id, number, kind) with their `init`, `context` and `compact` events only. */
async function stateOf(
  t: TenantDb,
  chatId: string,
  range: SeqRange,
): Promise<{ turns: Pick<ChatTurn, 'id' | 'seq' | 'kind'>[]; events: ChatEvent[] }> {
  const turns = await t
    .selectFields(
      chatTurns,
      { id: chatTurns.id, seq: chatTurns.seq, kind: chatTurns.kind },
      inRange(chatId, range),
    )
    .orderBy(asc(chatTurns.seq));
  const ids = t.selectFields(chatTurns, { id: chatTurns.id }, inRange(chatId, range));
  const type = sql`${chatEvents.event}->>'type'`;
  const events = await t
    .select(chatEvents, and(inArray(chatEvents.turnId, ids), inArray(type, [...STATE_EVENTS])))
    .orderBy(asc(chatEvents.seq));
  return { turns, events };
}

export const historyRepo = { clearsOf, latestOf, countOf, spansOf, stateOf };
