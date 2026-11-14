import { type Agent, agents, type Chat, chats, chatTurns, flowSteps, type TenantDb, tasks } from '@mwc/db';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';

/**
 * A task's conversations (S5.3b), through the company's tenant only: the agent a step's assignee is, the latest
 * conversation of a task at a step (of one agent), and a turn of the step's conversations that runs (or waits for its
 * machine). Since 2026-11-14 (T-19) an agent's task conversations for its chat list, and what names them there: their
 * tasks and steps (the tasks module's rows, read only) and every conversation of those tasks (for the rounds each
 * covers).
 */

/** The agent of a principal (archived ones too); undefined for a person or another company's principal. */
async function agentByPrincipal(t: TenantDb, principalId: string): Promise<Agent | undefined> {
  const [row] = await t.select(agents, eq(agents.principalId, principalId));
  return row;
}

/** The latest conversation of the task at the step with this agent, archived ones too; undefined before its first. */
async function latestOf(
  t: TenantDb,
  taskId: string,
  stepId: string,
  agentId: string,
): Promise<Chat | undefined> {
  const where = and(eq(chats.taskId, taskId), eq(chats.taskStepId, stepId), eq(chats.agentId, agentId));
  const [row] = await t.select(chats, where).orderBy(desc(chats.createdAt), desc(chats.id)).limit(1);
  return row;
}

/**
 * The id of a turn of any of the task's conversations at the step that runs, or waits for its stopped machine; undefined
 * when there is none.
 */
async function runningTurnOf(t: TenantDb, taskId: string, stepId: string): Promise<string | undefined> {
  const where = and(eq(chats.taskId, taskId), eq(chats.taskStepId, stepId));
  const ids = (await t.selectFields(chats, { id: chats.id }, where)).map((row) => row.id);
  if (ids.length === 0) return undefined;
  const waiting = and(eq(chatTurns.status, 'queued'), isNotNull(chatTurns.machineWaitAt));
  const running = and(inArray(chatTurns.chatId, ids), or(eq(chatTurns.status, 'running'), waiting));
  const [row] = await t.selectFields(chatTurns, { id: chatTurns.id }, running).limit(1);
  return row?.id;
}

/** The agent's task conversations not archived, the latest first (by `updated_at`, which a turn moves), `limit` of them. */
const ofAgent = (t: TenantDb, agentId: string, limit: number): Promise<Chat[]> =>
  t
    .select(chats, and(eq(chats.agentId, agentId), isNotNull(chats.taskId), isNull(chats.archivedAt)))
    .orderBy(desc(chats.updatedAt), desc(chats.id))
    .limit(limit);

/** These tasks (at least one) as a conversation's name needs them. */
const tasksOf = (t: TenantDb, ids: readonly string[]) =>
  t.selectFields(
    tasks,
    {
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      state: tasks.state,
      currentStepId: tasks.currentStepId,
      rounds: tasks.rounds,
    },
    inArray(tasks.id, [...ids]),
  );

/** The names of these steps (at least one), removed ones left out. */
const stepNames = (t: TenantDb, ids: readonly string[]) =>
  t.selectFields(flowSteps, { id: flowSteps.id, name: flowSteps.name }, inArray(flowSteps.id, [...ids]));

/** Every conversation of these tasks (at least one), archived ones too, oldest first. */
const conversationsOf = (t: TenantDb, taskIds: readonly string[]) =>
  t
    .selectFields(
      chats,
      { id: chats.id, taskId: chats.taskId, stepId: chats.taskStepId, round: chats.taskRound },
      inArray(chats.taskId, [...taskIds]),
    )
    .orderBy(asc(chats.createdAt), asc(chats.id));

export const taskChatsRepo = {
  agentByPrincipal,
  latestOf,
  runningTurnOf,
  ofAgent,
  tasksOf,
  stepNames,
  conversationsOf,
};
