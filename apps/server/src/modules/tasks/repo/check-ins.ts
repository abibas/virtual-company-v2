import { agents, chats, chatTurns, leadWakeEvents, type TenantDb, taskEvents, tasks } from '@mwc/db';
import type { CheckInTurn } from '@mwc/shared/flows';
import { and, eq, inArray, max, sql } from 'drizzle-orm';

/**
 * What a flow Lead's check-in reads (docs/processes.md "Check-ins"), through the company's tenant only: when each open
 * task last changed, whether the flow changed since its Lead was last told, the turns on the tasks' conversations at
 * their steps, and whether the Lead has a turn of its own (the chats' rows read only: the chats module owns them).
 */

/** The flow's tasks, as a subquery. */
const flowTasks = (t: TenantDb, flowId: string) =>
  t.selectFields(tasks, { id: tasks.id }, eq(tasks.flowId, flowId));

/** A running or waiting turn's status. */
const LIVE = ['running', 'queued'] as const;

/** When each of the flow's tasks last changed: its latest history row, by task id. */
async function lastEventAt(t: TenantDb, flowId: string): Promise<Map<string, Date>> {
  const rows = await t
    .selectFields(
      taskEvents,
      { taskId: taskEvents.taskId, at: max(taskEvents.createdAt) },
      inArray(taskEvents.taskId, flowTasks(t, flowId)),
    )
    .groupBy(taskEvents.taskId);
  return new Map(rows.map((row) => [row.taskId, row.at as Date]));
}

/**
 * True when a task of the flow has a history row written after the flow's latest wake-up row that was told (both by the
 * database's clock: an event's row is written with the move that made it, a check-in's as it is told); true before
 * any wake-up.
 */
async function changedSinceWoke(t: TenantDb, flowId: string): Promise<boolean> {
  const told = t.selectFields(
    leadWakeEvents,
    { at: max(leadWakeEvents.createdAt) },
    and(eq(leadWakeEvents.flowId, flowId), eq(leadWakeEvents.outcome, 'woke')),
  );
  const after = and(
    inArray(taskEvents.taskId, flowTasks(t, flowId)),
    sql`${taskEvents.createdAt} > coalesce((${told}), '-infinity'::timestamptz)`,
  );
  return (await t.selectFields(taskEvents, { id: taskEvents.id }, after).limit(1)).length > 0;
}

/**
 * The turn on each of these open tasks of the flow at its current step: `live` when one of its conversations there
 * runs, `waiting` when one waits to start (behind another, for a free slot, for its machine); a task with neither is
 * left out.
 */
async function turnsOn(
  t: TenantDb,
  flowId: string,
  open: readonly { readonly id: string; readonly currentStepId: string | null }[],
): Promise<Map<string, CheckInTurn>> {
  const stepOf = new Map(open.map((task) => [task.id, task.currentStepId]));
  const ofFlow = inArray(chats.taskId, flowTasks(t, flowId));
  const conversations = await t.selectFields(
    chats,
    { id: chats.id, taskId: chats.taskId, stepId: chats.taskStepId },
    ofFlow,
  );
  const atStep = new Map(
    conversations
      .filter((chat) => stepOf.get(chat.taskId as string) === chat.stepId)
      .map((chat) => [chat.id, chat.taskId as string]),
  );
  const rows = await t.selectFields(
    chatTurns,
    { chatId: chatTurns.chatId, status: chatTurns.status },
    and(
      inArray(chatTurns.chatId, t.selectFields(chats, { id: chats.id }, ofFlow)),
      inArray(chatTurns.status, [...LIVE]),
    ),
  );
  const mine = rows.filter((row) => atStep.has(row.chatId));
  const turns = new Map<string, CheckInTurn>(
    mine.map((row) => [atStep.get(row.chatId) as string, 'waiting']),
  );
  for (const row of mine.filter((one) => one.status === 'running'))
    turns.set(atStep.get(row.chatId) as string, 'live');
  return turns;
}

/** True when the agent of this principal has a turn running or waiting in any of its chats. */
async function agentBusy(t: TenantDb, principalId: string): Promise<boolean> {
  const agent = t.selectFields(agents, { id: agents.id }, eq(agents.principalId, principalId));
  const own = t.selectFields(chats, { id: chats.id }, inArray(chats.agentId, agent));
  const where = and(inArray(chatTurns.chatId, own), inArray(chatTurns.status, [...LIVE]));
  return (await t.selectFields(chatTurns, { id: chatTurns.id }, where).limit(1)).length > 0;
}

export const checkInRows = { lastEventAt, changedSinceWoke, turnsOn, agentBusy };
