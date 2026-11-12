import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Agent,
  type Chat,
  type Company,
  chats,
  chatTurns,
  type Flow,
  flows,
  leadWakeEvents,
  type Machine,
  type NewLeadWakeEvent,
  type Principal,
  type Task,
  tasks,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertAgent,
  insertCompany,
  insertMachine,
  insertPrincipal,
  MISSING_ID,
  migratedTestDb,
} from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let lead: Agent;
let mac: Machine;
let flow: Flow;
let task: Task;
let theirFlow: Flow;
let number = 0;

async function flowOf(company: Company, leadPrincipal: Principal | { id: string }): Promise<Flow> {
  const [row] = await handle.db
    .insert(flows)
    .values({
      companyId: company.id,
      leadPrincipalId: leadPrincipal.id,
      name: 'Delivery',
      createdBy: leadPrincipal.id,
    })
    .returning();
  return row as Flow;
}

async function taskOf(company: Company, of: Flow): Promise<Task> {
  const [row] = await handle.db
    .insert(tasks)
    .values({
      companyId: company.id,
      number: ++number,
      flowId: of.id,
      title: 'T',
      createdBy: of.leadPrincipalId,
    })
    .returning();
  return row as Task;
}

async function chatOf(values: Partial<typeof chats.$inferInsert> = {}): Promise<Chat> {
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: acme.id,
      agentId: lead.id,
      harness: 'claude_code',
      machineId: mac.id,
      createdBy: lead.principalId,
      ...values,
    })
    .returning();
  return row as Chat;
}

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  lead = await insertAgent(handle, acme.id);
  mac = await insertMachine(handle, acme.id);
  flow = await flowOf(acme, { id: lead.principalId });
  task = await taskOf(acme, flow);
  theirFlow = await flowOf(globex, await insertPrincipal(handle, globex.id));
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

const wake = (values: Partial<NewLeadWakeEvent> = {}) =>
  handle.db
    .insert(leadWakeEvents)
    .values({ companyId: acme.id, flowId: flow.id, taskId: task.id, kind: 'escalated', ...values })
    .returning();

describe('flows: the Lead wake-up settings (0025)', () => {
  it('defaults to escalated, blocked and a turn ended, a minute’s window, six an hour and forty a day', () => {
    expect(flow).toMatchObject({
      wakeEscalated: true,
      wakeBlocked: true,
      wakeTurnEnded: true,
      wakeDone: false,
      wakeSignoffHours: null,
      wakeWindowSeconds: 60,
      wakeMaxPerHour: 6,
      wakeMaxPerDay: 40,
    });
  });

  it('refuses settings out of their bounds', async () => {
    const lead2 = await insertPrincipal(handle, acme.id);
    const base = { companyId: acme.id, leadPrincipalId: lead2.id, name: 'F', createdBy: lead2.id };
    const insert = (values: Partial<typeof flows.$inferInsert>) =>
      handle.db.insert(flows).values({ ...base, ...values });
    expect(await constraint(insert({ wakeSignoffHours: 0 }))).toBe('flows_wake_signoff_hours_check');
    expect(await constraint(insert({ wakeSignoffHours: 169 }))).toBe('flows_wake_signoff_hours_check');
    expect(await constraint(insert({ wakeWindowSeconds: -1 }))).toBe('flows_wake_window_check');
    expect(await constraint(insert({ wakeWindowSeconds: 601 }))).toBe('flows_wake_window_check');
    expect(await constraint(insert({ wakeMaxPerHour: 0 }))).toBe('flows_wake_per_hour_check');
    expect(await constraint(insert({ wakeMaxPerDay: 501 }))).toBe('flows_wake_per_day_check');
    await insert({ wakeSignoffHours: 168, wakeWindowSeconds: 0, wakeMaxPerHour: 60, wakeMaxPerDay: 500 });
  });
});

describe('lead_wake_events (0025)', () => {
  it('keeps a pending event, and one told in a turn of the team chat', async () => {
    const [pending] = await wake({ stepName: 'Code review', reason: 'over its limit' });
    expect(pending).toMatchObject({ outcome: 'pending', seenAt: null, deliveredAt: null, turnId: null });
    const chat = await chatOf({ flowId: flow.id });
    const [woke] = await wake({
      outcome: 'woke',
      deliveredAt: new Date(),
      chatId: chat.id,
      turnId: MISSING_ID,
    });
    expect(woke).toMatchObject({ outcome: 'woke', chatId: chat.id });
    const [held] = await wake({ outcome: 'unreachable', deliveredAt: new Date(), detail: 'No runner' });
    expect(held?.detail).toBe('No runner');
  });

  it('refuses an unknown kind or outcome, and texts out of their bounds', async () => {
    expect(await constraint(wake({ kind: 'nudged' as never }))).toBe('lead_wake_events_kind_check');
    expect(await constraint(wake({ outcome: 'lost' as never, deliveredAt: new Date() }))).toBe(
      'lead_wake_events_outcome_check',
    );
    expect(await constraint(wake({ stepName: '' }))).toBe('lead_wake_events_step_name_check');
    expect(await constraint(wake({ reason: 'x'.repeat(301) }))).toBe('lead_wake_events_reason_check');
    expect(await constraint(wake({ detail: '' }))).toBe('lead_wake_events_detail_check');
  });

  it('keeps the outcome, its time and its turn together', async () => {
    const at = new Date();
    expect(await constraint(wake({ deliveredAt: at }))).toBe('lead_wake_events_delivered_check');
    expect(await constraint(wake({ outcome: 'capped' }))).toBe('lead_wake_events_delivered_check');
    expect(await constraint(wake({ outcome: 'woke', deliveredAt: at }))).toBe('lead_wake_events_woke_check');
    expect(await constraint(wake({ outcome: 'dropped', deliveredAt: at, turnId: MISSING_ID }))).toBe(
      'lead_wake_events_woke_check',
    );
    const chat = await chatOf();
    expect(
      await constraint(wake({ outcome: 'capped', deliveredAt: at, chatId: chat.id, turnId: null })),
    ).toBe('lead_wake_events_woke_check');
  });

  it('refuses another company’s flow, task or chat', async () => {
    expect(await constraint(wake({ flowId: theirFlow.id }))).toBe('lead_wake_events_flow_fk');
    const theirTask = await taskOf(globex, theirFlow);
    expect(await constraint(wake({ taskId: theirTask.id }))).toBe('lead_wake_events_task_fk');
    expect(
      await constraint(
        wake({ outcome: 'woke', deliveredAt: new Date(), chatId: MISSING_ID, turnId: MISSING_ID }),
      ),
    ).toBe('lead_wake_events_chat_fk');
  });
});

describe('chats: a flow’s team chat, and turns Most Wanted queued (0025)', () => {
  it('names the flow, never with a task, and never another company’s flow', async () => {
    const team = await chatOf({ flowId: flow.id, title: 'Delivery: team' });
    expect(team.flowId).toBe(flow.id);
    expect(
      await constraint(chatOf({ flowId: flow.id, taskId: task.id, taskStepId: MISSING_ID, taskRound: 1 })),
    ).toBe('chats_flow_check');
    expect(await constraint(chatOf({ flowId: theirFlow.id }))).toBe('chats_flow_fk');
  });

  it('marks a turn the system queued; a person’s is not', async () => {
    const chat = await chatOf({ flowId: flow.id });
    const base = { companyId: acme.id, chatId: chat.id, prompt: 'Wake', createdBy: lead.principalId };
    const [person] = await handle.db
      .insert(chatTurns)
      .values({ ...base, seq: 1 })
      .returning();
    const [system] = await handle.db
      .insert(chatTurns)
      .values({ ...base, seq: 2, system: true, delivery: 'after' })
      .returning();
    expect(person?.system).toBe(false);
    expect(system?.system).toBe(true);
  });
});
