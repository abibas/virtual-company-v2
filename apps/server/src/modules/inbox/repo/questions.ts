import { agents, chatEvents, chats, chatTurns, type TenantDb, tasks } from '@mwc/db';
import { and, inArray, isNull, ne, sql } from 'drizzle-orm';

/**
 * The chats' questions as the inbox reads them (S6b), read only (the chats module owns these rows): each chat's last turn
 * with its `question` and `answered` events, and the chats, agents and tasks they name. A question is open only in its
 * chat's last turn (docs/harness.md "Asking the person"), so only last turns are read.
 */

/** A chat's last turn that asked something, with its question and answer marks in order. */
export interface QuestionRow {
  readonly turnId: string;
  readonly seq: number;
  readonly chatId: string;
  readonly events: readonly { readonly event: Record<string, unknown>; readonly at: Date }[];
}

/** Every chat's last turn (`seq` the chat's highest) that has a `question` or `answered` event. */
async function lastTurnsAsking(t: TenantDb): Promise<QuestionRow[]> {
  const last = sql`${chatTurns.seq} = (select max(latest.seq) from chat_turns latest where latest.company_id = ${chatTurns.companyId} and latest.chat_id = ${chatTurns.chatId})`;
  const turns = await t.selectFields(
    chatTurns,
    { id: chatTurns.id, chatId: chatTurns.chatId, seq: chatTurns.seq },
    last,
  );
  if (turns.length === 0) return [];
  const marks = await t
    .selectFields(
      chatEvents,
      { turnId: chatEvents.turnId, event: chatEvents.event, at: chatEvents.at },
      and(
        inArray(
          chatEvents.turnId,
          turns.map((turn) => turn.id),
        ),
        sql`${chatEvents.event}->>'type' in ('question', 'answered')`,
      ),
    )
    .orderBy(chatEvents.seq);
  return turns.flatMap((turn) => {
    const events = marks.filter((mark) => mark.turnId === turn.id);
    return events.length === 0 ? [] : [{ turnId: turn.id, seq: turn.seq, chatId: turn.chatId, events }];
  });
}

/** These chats when not archived, with the agent each is with (not archived either) and the task it is a step of. */
async function chatsOf(t: TenantDb, chatIds: readonly string[]) {
  if (chatIds.length === 0) return [];
  const rows = await t.selectFields(
    chats,
    { id: chats.id, agentId: chats.agentId, title: chats.title, taskId: chats.taskId },
    and(inArray(chats.id, [...chatIds]), isNull(chats.archivedAt)),
  );
  const agentIds = [...new Set(rows.map((row) => row.agentId))];
  const live =
    agentIds.length === 0
      ? []
      : await t.selectFields(
          agents,
          { id: agents.id, principalId: agents.principalId },
          and(inArray(agents.id, agentIds), ne(agents.status, 'archived')),
        );
  const taskIds = [...new Set(rows.flatMap((row) => (row.taskId === null ? [] : [row.taskId])))];
  const numbers =
    taskIds.length === 0
      ? []
      : await t.selectFields(tasks, { id: tasks.id, number: tasks.number }, inArray(tasks.id, taskIds));
  const principal = new Map(live.map((agent) => [agent.id, agent.principalId]));
  const number = new Map(numbers.map((task) => [task.id, task.number]));
  return rows.flatMap((row) => {
    const agentPrincipalId = principal.get(row.agentId);
    if (agentPrincipalId === undefined) return [];
    const taskNumber = row.taskId === null ? null : (number.get(row.taskId) as number);
    return [{ ...row, agentPrincipalId, taskNumber }];
  });
}

export const questionRows = { lastTurnsAsking, chatsOf };
