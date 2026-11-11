import { type Chat, chats, chatTurns, type TenantDb } from '@mwc/db';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';

/**
 * A task's conversations, read only (the chats module owns these rows; S5.3b): the chats that name the task, and
 * whether a turn of its conversations at a step runs.
 */

/** A conversation as the task shows it. */
export type ConversationRow = Pick<
  Chat,
  'id' | 'agentId' | 'taskStepId' | 'taskRound' | 'title' | 'sessionId' | 'createdAt' | 'archivedAt'
>;

/** The task's conversations, oldest first. */
const ofTask = (t: TenantDb, taskId: string): Promise<ConversationRow[]> =>
  t
    .selectFields(
      chats,
      {
        id: chats.id,
        agentId: chats.agentId,
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

export const conversationRows = { ofTask, othersRunning };
