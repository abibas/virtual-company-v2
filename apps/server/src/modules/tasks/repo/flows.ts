import {
  type Flow,
  type FlowStep,
  flowSteps,
  flows,
  isUuid,
  type TenantDb,
  type TenantSet,
  type TenantValues,
  tasks,
} from '@mwc/db';
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';

/**
 * The flows and their steps, through the company's tenant only (S5.3a). A flow's row is the lock every change of its
 * steps and every move of its tasks takes (`lock`), so a step is never removed while a task enters it.
 */

/** The company's flows, oldest first. */
const list = (t: TenantDb): Promise<Flow[]> => t.select(flows).orderBy(asc(flows.createdAt), asc(flows.id));

/** One flow by id; undefined for an unknown, malformed or another company's id. */
async function get(t: TenantDb, id: string): Promise<Flow | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(flows, eq(flows.id, id));
  return row;
}

/** The flow a principal leads (a well-formed id), if any. */
async function byLead(t: TenantDb, leadPrincipalId: string): Promise<Flow | undefined> {
  const [row] = await t.select(flows, eq(flows.leadPrincipalId, leadPrincipalId));
  return row;
}

/** The flow's row, locked until the transaction ends; undefined when there is none. */
async function lock(t: TenantDb, id: string): Promise<Flow | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(flows, eq(flows.id, id)).for('update');
  return row;
}

async function insert(t: TenantDb, values: TenantValues<typeof flows>): Promise<Flow> {
  const [row] = (await t.insert(flows, values).returning()) as [Flow];
  return row;
}

async function update(t: TenantDb, id: string, set: TenantSet<typeof flows>): Promise<Flow> {
  const [row] = (await t.update(flows, set, eq(flows.id, id)).returning()) as [Flow];
  return row;
}

/** A flow's steps in order. */
const steps = (t: TenantDb, flowId: string): Promise<FlowStep[]> =>
  t.select(flowSteps, eq(flowSteps.flowId, flowId)).orderBy(asc(flowSteps.position));

/** Every step of the company's flows, in each flow's order. */
const allSteps = (t: TenantDb): Promise<FlowStep[]> =>
  t.select(flowSteps).orderBy(asc(flowSteps.flowId), asc(flowSteps.position));

/**
 * Moves every step of the flow far down the order, so the list's new positions can be written one by one without two
 * steps sharing a position on the way (`flow_steps_position_unique` is checked row by row).
 */
async function parkPositions(t: TenantDb, flowId: string, by: number): Promise<void> {
  await t.update(
    flowSteps,
    { position: sql`${flowSteps.position} + ${by}` as never },
    eq(flowSteps.flowId, flowId),
  );
}

/** Takes every send-back target off the flow's steps (before steps are removed or targets rewritten). */
async function clearTargets(t: TenantDb, flowId: string): Promise<void> {
  await t.update(flowSteps, { sendsBackToStepId: null }, eq(flowSteps.flowId, flowId));
}

async function insertStep(t: TenantDb, values: TenantValues<typeof flowSteps>): Promise<FlowStep> {
  const [row] = (await t.insert(flowSteps, values).returning()) as [FlowStep];
  return row;
}

async function updateStep(t: TenantDb, id: string, set: TenantSet<typeof flowSteps>): Promise<FlowStep> {
  const [row] = (await t.update(flowSteps, set, eq(flowSteps.id, id)).returning()) as [FlowStep];
  return row;
}

async function deleteSteps(t: TenantDb, ids: readonly string[]): Promise<void> {
  if (ids.length > 0) await t.delete(flowSteps, inArray(flowSteps.id, [...ids]));
}

/** The open tasks (active or escalated) at these steps or bound for them on a retry: their numbers, oldest first. */
async function tasksAt(t: TenantDb, stepIds: readonly string[]): Promise<number[]> {
  if (stepIds.length === 0) return [];
  const where = or(
    inArray(tasks.currentStepId, [...stepIds]),
    inArray(tasks.escalationTargetStepId, [...stepIds]),
  );
  const rows = await t.selectFields(tasks, { number: tasks.number }, where).orderBy(asc(tasks.number));
  return rows.map((row) => row.number);
}

/** How many open tasks (active or escalated: those at a step) each step of the flow has, by step id. */
async function openCounts(t: TenantDb, flowId: string): Promise<Map<string, number>> {
  const where = and(eq(tasks.flowId, flowId), inArray(tasks.state, ['active', 'escalated']));
  const rows = await t
    .selectFields(tasks, { stepId: tasks.currentStepId, n: count() }, where)
    .groupBy(tasks.currentStepId);
  return new Map(rows.map((row) => [row.stepId as string, row.n]));
}

export const flowRows = {
  list,
  get,
  byLead,
  lock,
  insert,
  update,
  steps,
  allSteps,
  parkPositions,
  clearTargets,
  insertStep,
  updateStep,
  deleteSteps,
  tasksAt,
  openCounts,
};
