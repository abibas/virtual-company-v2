import { type Agent, agents, type Chat, chats, chatTurns, type TenantDb } from '@mwc/db';
import { and, desc, eq, inArray } from 'drizzle-orm';

/**
 * A task's conversations (S5.3b), through the company's tenant only: the agent a step's assignee is, the latest
 * conversation of a task at a step (of one agent), and a turn of the step's conversations that runs.
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

/** The id of a running turn of any of the task's conversations at the step; undefined when none runs. */
async function runningTurnOf(t: TenantDb, taskId: string, stepId: string): Promise<string | undefined> {
  const where = and(eq(chats.taskId, taskId), eq(chats.taskStepId, stepId));
  const ids = (await t.selectFields(chats, { id: chats.id }, where)).map((row) => row.id);
  if (ids.length === 0) return undefined;
  const running = and(inArray(chatTurns.chatId, ids), eq(chatTurns.status, 'running'));
  const [row] = await t.selectFields(chatTurns, { id: chatTurns.id }, running).limit(1);
  return row?.id;
}

export const taskChatsRepo = { agentByPrincipal, latestOf, runningTurnOf };
