import { type Chat, chats, chatTurns, machines, type TenantDb } from '@mwc/db';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';

/**
 * A task's conversations, read only (the chats module owns these rows; S5.3b): the chats that name the task, and
 * their turns' states (the task page's list), whether a turn of its conversations at a step runs, and the names of
 * their machines (the machines module's rows).
 */

/** A conversation as the task shows it. */
export type ConversationRow = Pick<
  Chat,
  | 'id'
  | 'agentId'
  | 'machineId'
  | 'taskStepId'
  | 'taskRound'
  | 'title'
  | 'sessionId'
  | 'createdAt'
  | 'archivedAt'
>;

/** The task's conversations, oldest first. */
const ofTask = (t: TenantDb, taskId: string): Promise<ConversationRow[]> =>
  t
    .selectFields(
      chats,
      {
        id: chats.id,
        agentId: chats.agentId,
        machineId: chats.machineId,
        taskStepId: chats.taskStepId,
        taskRound: chats.taskRound,
        title: chats.title,
        sessionId: chats.sessionId,
        createdAt: chats.createdAt,
        archivedAt: chats.archivedAt,
      },
      eq(chats.taskId, taskId),
    )
    .orderBy(asc(chats.createdAt), asc(chats.id));

/** A turn of a task's conversation as its list shows it: how far it got and when. */
export type ConversationTurnRow = Pick<
  typeof chatTurns.$inferSelect,
  'id' | 'chatId' | 'seq' | 'status' | 'createdAt' | 'startedAt' | 'endedAt' | 'machineWaitAt' | 'machineWait'
>;

/** The turns of these conversations (Clears left out: they run nothing), for each one's state and last activity. */
async function turnsOf(t: TenantDb, chatIds: readonly string[]): Promise<ConversationTurnRow[]> {
  if (chatIds.length === 0) return [];
  return t.selectFields(
    chatTurns,
    {
      id: chatTurns.id,
      chatId: chatTurns.chatId,
      seq: chatTurns.seq,
      status: chatTurns.status,
      createdAt: chatTurns.createdAt,
      startedAt: chatTurns.startedAt,
      endedAt: chatTurns.endedAt,
      machineWaitAt: chatTurns.machineWaitAt,
      machineWait: chatTurns.machineWait,
    },
    and(inArray(chatTurns.chatId, [...chatIds]), ne(chatTurns.kind, 'clear')),
  );
}

/** True when a turn of the task's conversations at the step runs, other than `turnId`. */
async function othersRunning(t: TenantDb, taskId: string, stepId: string, turnId: string): Promise<boolean> {
  const where = and(eq(chats.taskId, taskId), eq(chats.taskStepId, stepId));
  // Never empty: the turn asking is of one of these conversations.
  const ids = (await t.selectFields(chats, { id: chats.id }, where)).map((row) => row.id);
  const running = and(
    inArray(chatTurns.chatId, ids),
    eq(chatTurns.status, 'running'),
    ne(chatTurns.id, turnId),
  );
  return (await t.selectFields(chatTurns, { id: chatTurns.id }, running).limit(1)).length > 0;
}

/** The names of these machines (the machines' rows read only), by id. */
async function machineNames(t: TenantDb, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await t.selectFields(
    machines,
    { id: machines.id, name: machines.name },
    inArray(machines.id, [...ids]),
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The name of a conversation's machine; null for an unknown chat or a machine removed since. */
async function machineOfChat(t: TenantDb, chatId: string): Promise<string | null> {
  const [chat] = await t.selectFields(chats, { machineId: chats.machineId }, eq(chats.id, chatId));
  if (chat === undefined) return null;
  return (await machineNames(t, [chat.machineId])).get(chat.machineId) ?? null;
}

export const conversationRows = { ofTask, turnsOf, othersRunning, machineNames, machineOfChat };
