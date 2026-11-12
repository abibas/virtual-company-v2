import {
  agents,
  chats,
  chatTurns,
  type RoomMessage,
  roomMessages,
  type TenantDb,
  type TenantValues,
  tasks,
} from '@mwc/db';
import { and, desc, eq, gt, gte, inArray, isNotNull, max, or, sql } from 'drizzle-orm';

/**
 * A flow's team room (docs/processes.md "The team room"), through the company's tenant only: its messages (written, a
 * page of them, those since a time), the answers its people's messages asked for lately (the cap), and what it reads of
 * the agents' room conversations (the chats' rows, read only: the chats module owns them): the turns Most Wanted queued
 * there that still wait or run, when an agent's last turn there started, and whose conversation a chat is.
 */

const insert = async (t: TenantDb, values: TenantValues<typeof roomMessages>): Promise<RoomMessage> =>
  (await t.insert(roomMessages, values).returning())[0] as RoomMessage;

/** Sets how many agents' turns a person's message began. */
async function setAsked(t: TenantDb, id: string, asked: number): Promise<void> {
  await t.update(roomMessages, { asked }, eq(roomMessages.id, id));
}

/** A cursor into the feed: a message's time and id. */
export interface RoomCursor {
  readonly at: Date;
  readonly id: string;
}

/** The latest `limit` messages of the flow (before the cursor, when given), oldest first. */
async function page(t: TenantDb, flowId: string, limit: number, before?: RoomCursor): Promise<RoomMessage[]> {
  const older =
    before === undefined
      ? undefined
      : or(
          sql`${roomMessages.createdAt} < ${before.at}`,
          and(eq(roomMessages.createdAt, before.at), sql`${roomMessages.id} < ${before.id}`),
        );
  const rows = await t
    .select(roomMessages, and(eq(roomMessages.flowId, flowId), older))
    .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** The flow's messages written after `after` (all of them for none), the latest `limit`, oldest first. */
async function since(t: TenantDb, flowId: string, after: Date | null, limit: number): Promise<RoomMessage[]> {
  const rows = await t
    .select(
      roomMessages,
      and(eq(roomMessages.flowId, flowId), after ? gt(roomMessages.createdAt, after) : undefined),
    )
    .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** The answers the flow's people's messages asked for since `from` (each agent's turn begun is one). */
async function askedSince(t: TenantDb, flowId: string, from: Date): Promise<number> {
  const [row] = await t.selectFields(
    roomMessages,
    { n: sql<number>`coalesce(sum(${roomMessages.asked}), 0)::int` },
    and(eq(roomMessages.flowId, flowId), gte(roomMessages.createdAt, from)),
  );
  return row?.n ?? 0;
}

/** The flow's room conversations (its chats), as a subquery. */
const roomChats = (t: TenantDb, flowId: string) =>
  t.selectFields(chats, { id: chats.id }, eq(chats.flowId, flowId));

/** A turn Most Wanted queued in the flow's room conversations that still waits or runs, with its agent. */
export interface RoomTurnNow {
  readonly agentPrincipalId: string;
  readonly status: 'queued' | 'running';
  readonly machineWait: string | null;
}

/** The turns Most Wanted queued in the flow's room conversations that still wait or run, with their agents. */
async function busy(t: TenantDb, flowId: string): Promise<RoomTurnNow[]> {
  const turns = await t.selectFields(
    chatTurns,
    { chatId: chatTurns.chatId, status: chatTurns.status, machineWait: chatTurns.machineWait },
    and(
      inArray(chatTurns.chatId, roomChats(t, flowId)),
      eq(chatTurns.system, true),
      inArray(chatTurns.status, ['queued', 'running']),
    ),
  );
  if (turns.length === 0) return [];
  const owners = await chatAgents(t, [...new Set(turns.map((turn) => turn.chatId))]);
  return turns.flatMap((turn) => {
    const agentPrincipalId = owners.get(turn.chatId);
    if (agentPrincipalId === undefined) return [];
    const status = turn.status as RoomTurnNow['status'];
    return [{ agentPrincipalId, status, machineWait: turn.machineWait }];
  });
}

/** The agents' principals of these chats, by chat id. */
async function chatAgents(t: TenantDb, chatIds: readonly string[]): Promise<Map<string, string>> {
  if (chatIds.length === 0) return new Map();
  const rows = await t.selectFields(
    chats,
    { id: chats.id, agentId: chats.agentId },
    inArray(chats.id, [...chatIds]),
  );
  const ids = [...new Set(rows.map((row) => row.agentId))];
  const principals = await t.selectFields(
    agents,
    { id: agents.id, principalId: agents.principalId },
    inArray(agents.id, ids),
  );
  const byAgent = new Map(principals.map((row) => [row.id, row.principalId]));
  return new Map(
    rows.flatMap((row) => {
      const principal = byAgent.get(row.agentId);
      return principal === undefined ? [] : [[row.id, principal] as const];
    }),
  );
}

/** When the agent's last turn in the flow's room conversations started; null before any. */
async function lastStartedAt(t: TenantDb, flowId: string, agentPrincipalId: string): Promise<Date | null> {
  const agent = t.selectFields(agents, { id: agents.id }, eq(agents.principalId, agentPrincipalId));
  const own = t.selectFields(
    chats,
    { id: chats.id },
    and(eq(chats.flowId, flowId), inArray(chats.agentId, agent)),
  );
  const [row] = await t.selectFields(
    chatTurns,
    { at: max(chatTurns.startedAt) },
    and(inArray(chatTurns.chatId, own), isNotNull(chatTurns.startedAt)),
  );
  return row?.at ?? null;
}

/** A chat's flow and its agent's principal, when it is a flow's room conversation; undefined otherwise. */
async function roomChat(t: TenantDb, chatId: string) {
  const [chat] = await t.selectFields(chats, { flowId: chats.flowId }, eq(chats.id, chatId));
  if (chat?.flowId === null || chat?.flowId === undefined) return undefined;
  const agentPrincipalId = (await chatAgents(t, [chatId])).get(chatId);
  return agentPrincipalId === undefined ? undefined : { flowId: chat.flowId, agentPrincipalId };
}

/** The keys and titles of these tasks (the feed's step-end lines name theirs). */
const tasksOf = (t: TenantDb, ids: readonly string[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : t.selectFields(
        tasks,
        { id: tasks.id, number: tasks.number, title: tasks.title },
        inArray(tasks.id, [...ids]),
      );

export const roomRows = { insert, setAsked, page, since, askedSince, busy, lastStartedAt, roomChat, tasksOf };
