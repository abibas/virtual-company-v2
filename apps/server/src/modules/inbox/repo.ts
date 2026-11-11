import {
  agents,
  type Flow,
  type FlowStep,
  flowSteps,
  flows,
  memberships,
  type Task,
  type TaskEvent,
  type TenantDb,
  taskEvents,
  tasks,
} from '@mwc/db';
import { and, asc, eq, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { questionRows } from './repo/questions.ts';

export type { QuestionRow } from './repo/questions.ts';

/**
 * The inbox's reads, through the company's tenant only and read only (S6b): the rows belong to the tasks, chats, org and
 * members modules, and the inbox writes none. Its open tasks, their flows, steps and history, the viewer's membership, and
 * the names of the principals it shows; the chats' open questions are `repo/questions.ts`'s.
 */

/** The company's flows and every step of theirs. */
async function flowsAndSteps(t: TenantDb): Promise<{ flows: Flow[]; steps: FlowStep[] }> {
  return { flows: await t.select(flows), steps: await t.select(flowSteps) };
}

/**
 * The open tasks that may need someone: escalated, blocked or whose turn ended without a hand-off, and those active at
 * one of `stepIds` (the viewer's own steps), the oldest first.
 */
function waiting(t: TenantDb, stepIds: readonly string[]): Promise<Task[]> {
  const mine: SQL = stepIds.length === 0 ? sql`false` : (inArray(tasks.currentStepId, [...stepIds]) as SQL);
  const active = and(
    eq(tasks.state, 'active'),
    or(inArray(tasks.stepState, ['blocked', 'ended_without_handoff']), mine),
  );
  return t.select(tasks, or(eq(tasks.state, 'escalated'), active)).orderBy(asc(tasks.number));
}

/** These tasks' (one or more) history rows that move or stop them (no `entered`, `started` or `edited`), oldest first. */
function moves(t: TenantDb, taskIds: readonly string[]): Promise<TaskEvent[]> {
  const where = and(
    inArray(taskEvents.taskId, [...taskIds]),
    notInArray(taskEvents.kind, ['entered', 'started', 'edited']),
  );
  return t.select(taskEvents, where).orderBy(asc(taskEvents.id));
}

/** The person's membership here (their principal and role); undefined for none. */
async function memberOf(t: TenantDb, userId: string) {
  const fields = { principalId: memberships.principalId, role: memberships.role };
  const [row] = await t.selectFields(memberships, fields, eq(memberships.userId, userId));
  return row;
}

/** The agents of these principals: names, slugs and ids (archived ones too, so the history keeps its names). */
function agentsOf(t: TenantDb, principalIds: readonly string[]) {
  if (principalIds.length === 0) return Promise.resolve([]);
  const fields = { id: agents.id, principalId: agents.principalId, name: agents.name, slug: agents.slug };
  return t.selectFields(agents, fields, inArray(agents.principalId, [...principalIds]));
}

/** The memberships of these principals: whose person they are (former members too). */
function membersOf(t: TenantDb, principalIds: readonly string[]) {
  if (principalIds.length === 0) return Promise.resolve([]);
  const fields = { principalId: memberships.principalId, userId: memberships.userId };
  return t.selectFields(memberships, fields, inArray(memberships.principalId, [...principalIds]));
}

export const inboxRepo = {
  flowsAndSteps,
  waiting,
  moves,
  memberOf,
  agentsOf,
  membersOf,
  questions: questionRows,
};

export type InboxRepo = typeof inboxRepo;
