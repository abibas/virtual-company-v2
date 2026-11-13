import {
  type ChatEvent,
  type ChatTurn,
  chatEvents,
  chatTurns,
  isUuid,
  type TenantDb,
  type TenantSet,
  type TenantValues,
} from '@mwc/db';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, max } from 'drizzle-orm';

/** A chat's turns and their events (S5.1b), through the company's tenant only. */

/** One turn of a chat; undefined for an unknown, malformed or another chat's id. */
async function get(t: TenantDb, chatId: string, id: string): Promise<ChatTurn | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(chatTurns, and(eq(chatTurns.chatId, chatId), eq(chatTurns.id, id)));
  return row;
}

/** One turn by its id alone (a runner names it, S5.4); undefined for an unknown or malformed id. */
async function byId(t: TenantDb, id: string): Promise<ChatTurn | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(chatTurns, eq(chatTurns.id, id));
  return row;
}

/** The chat's turns from `fromSeq` on, in order. */
const ofChat = (t: TenantDb, chatId: string, fromSeq = 1): Promise<ChatTurn[]> =>
  t
    .select(chatTurns, and(eq(chatTurns.chatId, chatId), gte(chatTurns.seq, fromSeq)))
    .orderBy(asc(chatTurns.seq));

/** The chat's queued or running turn, if it has one. */
async function liveOf(t: TenantDb, chatId: string): Promise<ChatTurn | undefined> {
  const [row] = await t.select(
    chatTurns,
    and(eq(chatTurns.chatId, chatId), inArray(chatTurns.status, ['queued', 'running'])),
  );
  return row;
}

/** The chat's latest turn (its highest number), undefined before its first. */
async function lastOf(t: TenantDb, chatId: string): Promise<ChatTurn | undefined> {
  const [row] = await t.select(chatTurns, eq(chatTurns.chatId, chatId)).orderBy(desc(chatTurns.seq)).limit(1);
  return row;
}

/** The chat's highest turn number, 0 before its first turn. */
async function lastSeq(t: TenantDb, chatId: string): Promise<number> {
  const [row] = await t.selectFields(chatTurns, { seq: max(chatTurns.seq) }, eq(chatTurns.chatId, chatId));
  return row?.seq ?? 0;
}

async function insert(t: TenantDb, values: TenantValues<typeof chatTurns>): Promise<ChatTurn> {
  const [row] = (await t.insert(chatTurns, values).returning()) as [ChatTurn];
  return row;
}

/** Changes a turn while it is still live; undefined when it already ended (a late frame changes nothing). */
async function updateLive(
  t: TenantDb,
  id: string,
  set: TenantSet<typeof chatTurns>,
): Promise<ChatTurn | undefined> {
  const where = and(eq(chatTurns.id, id), inArray(chatTurns.status, ['queued', 'running']));
  const [row] = await t.update(chatTurns, set, where).returning();
  return row;
}

/**
 * A failed turn running again (its runner came back with it, 2026-11-12), while it is still failed with the same error;
 * undefined otherwise.
 */
async function reopen(t: TenantDb, turn: ChatTurn): Promise<ChatTurn | undefined> {
  if (turn.status !== 'failed' || turn.error === null) return undefined;
  const where = and(
    eq(chatTurns.id, turn.id),
    eq(chatTurns.status, 'failed'),
    eq(chatTurns.error, turn.error),
  );
  const [row] = await t
    .update(chatTurns, { status: 'running', error: null, endedAt: null }, where)
    .returning();
  return row;
}

/** True when a turn of the chat after turn number `seq` ever started. */
async function startedAfter(t: TenantDb, chatId: string, seq: number): Promise<boolean> {
  const where = and(eq(chatTurns.chatId, chatId), gt(chatTurns.seq, seq), isNotNull(chatTurns.startedAt));
  const [row] = await t.selectFields(chatTurns, { id: chatTurns.id }, where).limit(1);
  return row !== undefined;
}

/** Stores events of a turn (one or more); one already stored (a resend) is kept as it was. Returns the new ones. */
async function insertEvents(
  t: TenantDb,
  turnId: string,
  events: readonly { readonly seq: number; readonly event: Record<string, unknown>; readonly at: Date }[],
): Promise<ChatEvent[]> {
  const rows = events.map((item) => ({ turnId, ...item }));
  return t.insert(chatEvents, rows).onConflictDoNothing().returning();
}

/** The highest event number of a turn, 0 before its first event. */
async function lastEventSeq(t: TenantDb, turnId: string): Promise<number> {
  const [row] = await t.selectFields(chatEvents, { seq: max(chatEvents.seq) }, eq(chatEvents.turnId, turnId));
  return row?.seq ?? 0;
}

/** The events of these turns, in order. */
const eventsOf = (t: TenantDb, turnIds: readonly string[]): Promise<ChatEvent[]> =>
  turnIds.length === 0
    ? Promise.resolve([])
    : t.select(chatEvents, inArray(chatEvents.turnId, [...turnIds])).orderBy(asc(chatEvents.seq));

export const turnsRepo = {
  get,
  byId,
  ofChat,
  liveOf,
  lastOf,
  lastSeq,
  insert,
  updateLive,
  reopen,
  startedAfter,
  insertEvents,
  lastEventSeq,
  eventsOf,
};
