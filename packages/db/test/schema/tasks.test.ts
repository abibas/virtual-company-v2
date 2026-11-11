import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Company,
  type Flow,
  type FlowStep,
  flowSteps,
  flows,
  type NewTask,
  type NewTaskEvent,
  type Principal,
  type Task,
  taskEvents,
  tasks,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertPrincipal, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let owner: Principal;
let flow: Flow;
let step: FlowStep;
let theirStep: FlowStep;
let number = 0;

async function flowWithStep(company: Company, lead: Principal): Promise<[Flow, FlowStep]> {
  const [made] = await handle.db
    .insert(flows)
    .values({ companyId: company.id, leadPrincipalId: lead.id, name: 'Delivery', createdBy: lead.id })
    .returning();
  const [first] = await handle.db
    .insert(flowSteps)
    .values({
      companyId: company.id,
      flowId: (made as Flow).id,
      position: 1,
      name: 'Develop',
      kind: 'work',
      assigneePrincipalId: lead.id,
    })
    .returning();
  return [made as Flow, first as FlowStep];
}

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  owner = await insertPrincipal(handle, acme.id);
  [flow, step] = await flowWithStep(acme, owner);
  [, theirStep] = await flowWithStep(globex, await insertPrincipal(handle, globex.id));
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

async function insertTask(values: Partial<NewTask> = {}): Promise<Task> {
  const [row] = await handle.db
    .insert(tasks)
    .values({
      companyId: acme.id,
      number: ++number,
      flowId: flow.id,
      title: 'Fix login',
      createdBy: owner.id,
      ...values,
    })
    .returning();
  if (!row) throw new Error('no task returned');
  return row;
}

const active = () => ({ state: 'active' as const, currentStepId: step.id, stepState: 'waiting' as const });

describe('tasks', () => {
  it('stores a queued task with its defaults, numbered once per company', async () => {
    const task = await insertTask();
    expect(task).toMatchObject({
      description: '',
      priority: 'normal',
      state: 'queued',
      currentStepId: null,
      stepState: null,
      rounds: {},
      escalationReason: null,
      closedAt: null,
    });
    expect(await constraint(insertTask({ number: task.number }))).toBe('tasks_number_unique');
    expect(await constraint(insertTask({ number: 0 }))).toBe('tasks_number_check');
  });

  it('refuses an empty or long title, a long description, an unknown priority, state or step state', async () => {
    expect(await constraint(insertTask({ title: '' }))).toBe('tasks_title_check');
    expect(await constraint(insertTask({ title: 't'.repeat(201) }))).toBe('tasks_title_check');
    expect(await constraint(insertTask({ description: 'd'.repeat(50_001) }))).toBe('tasks_description_check');
    expect(await constraint(insertTask({ priority: 'asap' as never }))).toBe('tasks_priority_check');
    expect(await constraint(insertTask({ state: 'open' as never }))).toBe('tasks_state_check');
    expect(await constraint(insertTask({ ...active(), stepState: 'idle' as never }))).toBe(
      'tasks_step_state_check',
    );
    expect(await constraint(insertTask({ rounds: [] as never }))).toBe('tasks_rounds_check');
  });

  it('keeps the state and its columns in step', async () => {
    expect((await insertTask(active())).state).toBe('active');
    expect(await constraint(insertTask({ state: 'active' }))).toBe('tasks_step_check');
    expect(await constraint(insertTask({ currentStepId: step.id }))).toBe('tasks_step_check');
    expect(await constraint(insertTask({ ...active(), stepState: null }))).toBe(
      'tasks_step_state_presence_check',
    );
    const escalated = { state: 'escalated' as const, currentStepId: step.id };
    expect(await constraint(insertTask(escalated))).toBe('tasks_escalation_check');
    expect(
      (
        await insertTask({
          ...escalated,
          escalationReason: 'Sent back 3 times',
          escalationTargetStepId: step.id,
        })
      ).state,
    ).toBe('escalated');
    expect(await constraint(insertTask({ ...active(), escalationTargetStepId: step.id }))).toBe(
      'tasks_escalation_check',
    );
    expect(await constraint(insertTask({ ...escalated, escalationReason: '' }))).toBe(
      'tasks_escalation_reason_check',
    );
    expect(await constraint(insertTask({ state: 'done' }))).toBe('tasks_closed_check');
    expect(await constraint(insertTask({ closedAt: new Date() }))).toBe('tasks_closed_check');
    expect((await insertTask({ state: 'cancelled', closedAt: new Date() })).state).toBe('cancelled');
  });

  it('keeps a blocked reason only while the task is blocked at its step (S5.3b)', async () => {
    const blocked = { ...active(), stepState: 'blocked' as const };
    expect((await insertTask({ ...blocked, blockedReason: 'machine_offline' })).blockedReason).toBe(
      'machine_offline',
    );
    expect((await insertTask(blocked)).blockedReason).toBeNull();
    expect(await constraint(insertTask({ ...active(), blockedReason: 'x' }))).toBe(
      'tasks_blocked_reason_check',
    );
    expect(await constraint(insertTask({ ...blocked, blockedReason: '' }))).toBe(
      'tasks_blocked_reason_check',
    );
    expect(await constraint(insertTask({ ...blocked, blockedReason: 'r'.repeat(2001) }))).toBe(
      'tasks_blocked_reason_check',
    );
  });

  it("refuses another company's flow, step or creator, and keeps a step with a task at it", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await constraint(insertTask({ createdBy: theirs.id }))).toBe('tasks_created_by_fk');
    expect(await constraint(insertTask({ flowId: theirStep.flowId }))).toBe('tasks_flow_fk');
    expect(await constraint(insertTask({ ...active(), currentStepId: theirStep.id }))).toBe(
      'tasks_current_step_fk',
    );
    const escalated = { state: 'escalated' as const, currentStepId: step.id, escalationReason: 'r' };
    expect(await constraint(insertTask({ ...escalated, escalationTargetStepId: theirStep.id }))).toBe(
      'tasks_escalation_target_fk',
    );
    expect(await constraint(handle.db.delete(flowSteps).where(eq(flowSteps.id, step.id)))).toBe(
      'tasks_current_step_fk',
    );
  });
});

describe('task_events', () => {
  let task: Task;
  beforeAll(async () => {
    task = await insertTask();
  });

  const insertEvent = (values: Partial<NewTaskEvent> = {}) =>
    handle.db
      .insert(taskEvents)
      .values({ companyId: acme.id, taskId: task.id, kind: 'created', ...values })
      .returning();

  it('keeps the history with plain step ids, their names as they were, and who did it', async () => {
    const [row] = await insertEvent({
      kind: 'sent_back',
      actorPrincipalId: owner.id,
      fromStepId: step.id,
      fromStepName: 'Review',
      toStepId: '0190f5f0-0000-7000-8000-000000000000',
      toStepName: 'Removed since',
      round: 2,
      reason: 'Tests fail',
    });
    expect(row).toMatchObject({ kind: 'sent_back', round: 2, details: {}, reason: 'Tests fail' });
    expect((await insertEvent())[0]?.actorPrincipalId).toBeNull();
  });

  it('refuses an unknown kind, a round below 1, an empty reason, details that are not an object', async () => {
    expect(await constraint(insertEvent({ kind: 'moved' as never }))).toBe('task_events_kind_check');
    expect(await constraint(insertEvent({ round: 0 }))).toBe('task_events_round_check');
    expect(await constraint(insertEvent({ reason: '' }))).toBe('task_events_reason_check');
    expect(await constraint(insertEvent({ details: 'x' as never }))).toBe('task_events_details_check');
  });

  it("refuses another company's task or actor", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await constraint(insertEvent({ actorPrincipalId: theirs.id }))).toBe('task_events_actor_fk');
    expect(await constraint(insertEvent({ companyId: globex.id }))).toBe('task_events_task_fk');
  });
});
