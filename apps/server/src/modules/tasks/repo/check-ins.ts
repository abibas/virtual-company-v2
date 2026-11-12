import { agents, chats, chatTurns, leadWakeEvents, type TenantDb, taskEvents, tasks } from '@mwc/db';
import type { CheckInTurn } from '@mwc/shared/flows';
import { and, eq, gt, inArray, max } from 'drizzle-orm';

/**
 * What a flow Lead's check-in reads (docs/processes.md "Check-ins"), through the company's tenant only: when each open
 * task last changed, whether the flow changed since a time, the turns on the tasks' conversations at their steps, and
 * whether the Lead has a turn of its own (the chats' rows read only: the chats module owns them).
 */

/** When each of these tasks last changed: its latest history row, by task id. */
async function lastEventAt(t: TenantDb, taskIds: readonly string[]): Promise<Map<string, Date>> {
  if (taskIds.length === 0) return new Map();
  const rows = await t
    .selectFields(
      taskEvents,
      { taskId: taskEvents.taskId, at: max(taskEvents.createdAt) },
      inArray(taskEvents.taskId, [...taskIds]),
    )
    .groupBy(taskEvents.taskId);
  return new Map(rows.flatMap((row) => (row.at === null ? [] : [[row.taskId, row.at] as const])));
}

/**
 * True when a task of the flow has a history row written after the flow's latest wake-up row that was told (both by the
 * database's clock: an event's row is written with the move that made it, a check-in's as it is told); true before
 * any wake-up.
 */
async function changedSinceWoke(t: TenantDb, flowId: string): Promise<boolean> {
  const [woke] = await t.selectFields(
    leadWakeEvents,
    { at: max(leadWakeEvents.createdAt) },
    and(eq(leadWakeEvents.flowId, flowId), eq(leadWakeEvents.outcome, 'woke')),
  );
  if (woke?.at === null || woke?.at === undefined) return true;
  const ofFlow = (await t.selectFields(tasks, { id: tasks.id }, eq(tasks.flowId, flowId))).map(
    (row) => row.id,
  );
  if (ofFlow.length === 0) return false;
  const after = and(inArray(taskEvents.taskId, ofFlow), gt(taskEvents.createdAt, woke.at));
  return (await t.selectFields(taskEvents, { id: taskEvents.id }, after).limit(1)).length > 0;
}

/** The running and waiting turns of these chats. */
const liveTurnsOf = (t: TenantDb, chatIds: readonly string[]) =>
  chatIds.length === 0
    ? Promise.resolve([])
    : t.selectFields(
        chatTurns,
        { chatId: chatTurns.chatId, status: chatTurns.status },
        and(inArray(chatTurns.chatId, [...chatIds]), inArray(chatTurns.status, ['running', 'queued'])),
      );

/**
 * The turn on each of these tasks at its current step: `live` when one of its conversations there runs, `waiting` when
 * one waits to start (behind another, for a free slot, for its machine); a task with neither is left out.
 */
async function turnsOn(
  t: TenantDb,
  open: readonly { readonly id: string; readonly currentStepId: string | null }[],
): Promise<Map<string, CheckInTurn>> {
  const atStep = new Map(
    open.flatMap((task) => (task.currentStepId === null ? [] : [[task.id, task.currentStepId] as const])),
  );
  if (atStep.size === 0) return new Map();
  const conversations = await t.selectFields(
    chats,
    { id: chats.id, taskId: chats.taskId, stepId: chats.taskStepId },
    inArray(chats.taskId, [...atStep.keys()]),
  );
  const taskOf = new Map(
    conversations.flatMap((chat) =>
      chat.taskId !== null && atStep.get(chat.taskId) === chat.stepId
        ? [[chat.id, chat.taskId] as const]
        : [],
    ),
  );
  const turns = new Map<string, CheckInTurn>();
  for (const row of await liveTurnsOf(t, [...taskOf.keys()])) {
    const taskId = taskOf.get(row.chatId) as string;
    if (row.status === 'running') turns.set(taskId, 'live');
    else if (!turns.has(taskId)) turns.set(taskId, 'waiting');
  }
  return turns;
}

/** True when the agent of this principal has a turn running or waiting in any of its chats. */
async function agentBusy(t: TenantDb, principalId: string): Promise<boolean> {
  const [agent] = await t.selectFields(agents, { id: agents.id }, eq(agents.principalId, principalId));
  if (agent === undefined) return false;
  const own = await t.selectFields(chats, { id: chats.id }, eq(chats.agentId, agent.id));
  return (
    (
      await liveTurnsOf(
        t,
        own.map((chat) => chat.id),
      )
    ).length > 0
  );
}

export const checkInRows = { lastEventAt, changedSinceWoke, turnsOn, agentBusy };
