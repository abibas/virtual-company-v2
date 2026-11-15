import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Company,
  type Flow,
  flows,
  type NewSprint,
  type Principal,
  type Sprint,
  type SprintReport,
  sprints,
  tasks,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertPrincipal, migratedTestDb } from '../fixtures/rows.ts';

/**
 * A flow's sprints (T-37, migration `0048_sprints`): numbered per flow from 1, named 1 to 80 characters, one current
 * (not ended) per flow, a report only once ended, and `tasks_join_current_sprint`, which puts a task inserted without
 * a sprint into its flow's current one and makes Sprint 1 when the flow has none.
 */

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let lead: Principal;
let number = 0;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  lead = await insertPrincipal(handle, acme.id);
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

async function insertFlow(company: Company = acme): Promise<Flow> {
  const leader = await insertPrincipal(handle, company.id);
  const [row] = await handle.db
    .insert(flows)
    .values({ companyId: company.id, leadPrincipalId: leader.id, name: 'Delivery', createdBy: leader.id })
    .returning();
  return row as Flow;
}

const insertSprint = (flow: Flow, values: Partial<NewSprint> = {}) =>
  handle.db
    .insert(sprints)
    .values({
      companyId: flow.companyId,
      flowId: flow.id,
      number: 1,
      name: 'Sprint 1',
      startedAt: new Date('2026-11-15T09:00:00Z'),
      startedBy: lead.id,
      ...values,
    })
    .returning();

const insertTask = (flow: Flow) =>
  handle.db
    .insert(tasks)
    .values({
      companyId: flow.companyId,
      number: ++number,
      flowId: flow.id,
      title: 'Ship it',
      createdBy: lead.id,
    })
    .returning();

const sprintsOf = (flow: Flow): Promise<Sprint[]> =>
  handle.db.select().from(sprints).where(eq(sprints.flowId, flow.id)).orderBy(sprints.number);

const REPORT: SprintReport = { done: [], cancelled: [], carriedOver: [], created: 0 };

describe('sprints', () => {
  it('makes Sprint 1 for the first task of a flow without one, and puts the next task in it too', async () => {
    const flow = await insertFlow();
    const [first] = await insertTask(flow);
    const made = await sprintsOf(flow);
    expect(made).toMatchObject([{ number: 1, name: 'Sprint 1', startedBy: flow.createdBy, endedAt: null }]);
    expect(first?.sprintId).toBe(made[0]?.id);
    const [second] = await insertTask(flow);
    expect(second?.sprintId).toBe(made[0]?.id);
    expect(await sprintsOf(flow)).toHaveLength(1);
  });

  it('puts a new task into the current sprint, never an ended one', async () => {
    const flow = await insertFlow();
    const [old] = await insertSprint(flow, { endedAt: new Date('2026-11-16T09:00:00Z'), endedBy: lead.id });
    const [now] = await insertSprint(flow, { number: 2, name: 'Sprint 2' });
    const [task] = await insertTask(flow);
    expect(task?.sprintId).toBe(now?.id);
    expect(task?.sprintId).not.toBe(old?.id);
  });

  it('keeps one current sprint per flow, numbers unique per flow from 1, names 1 to 80 characters', async () => {
    const flow = await insertFlow();
    await insertSprint(flow);
    expect(await constraint(insertSprint(flow, { number: 2 }))).toBe('sprints_one_current_idx');
    const ended = { endedAt: new Date('2026-11-16T09:00:00Z'), endedBy: lead.id };
    expect(await constraint(insertSprint(flow, ended))).toBe('sprints_number_unique');
    expect(await constraint(insertSprint(flow, { ...ended, number: 0 }))).toBe('sprints_number_check');
    expect(await constraint(insertSprint(flow, { ...ended, number: 2, name: '' }))).toBe(
      'sprints_name_check',
    );
    expect(await constraint(insertSprint(flow, { ...ended, number: 2, name: 'n'.repeat(81) }))).toBe(
      'sprints_name_check',
    );
    expect((await insertSprint(await insertFlow()))[0]?.number).toBe(1);
  });

  it('is ended by someone only once ended, and keeps a report (an object) only once ended', async () => {
    const flow = await insertFlow();
    const [current] = await insertSprint(flow);
    const update = (values: Partial<NewSprint>) =>
      handle.db
        .update(sprints)
        .set(values)
        .where(eq(sprints.id, (current as Sprint).id));
    expect(await constraint(update({ endedBy: lead.id }))).toBe('sprints_ended_check');
    expect(await constraint(update({ report: REPORT }))).toBe('sprints_report_check');
    const endedAt = new Date('2026-11-20T09:00:00Z');
    expect(await constraint(update({ endedAt, report: [] as never }))).toBe('sprints_report_check');
    const [closed] = await update({ endedAt, endedBy: lead.id, report: REPORT }).returning();
    expect(closed).toMatchObject({ endedAt, endedBy: lead.id, report: REPORT });
  });

  it("refuses another company's flow, starter or ender", async () => {
    const flow = await insertFlow();
    const theirs = await insertPrincipal(handle, globex.id);
    const theirFlow = await insertFlow(globex);
    expect(await constraint(insertSprint(theirFlow, { companyId: acme.id }))).toBe('sprints_flow_fk');
    expect(await constraint(insertSprint(flow, { startedBy: theirs.id }))).toBe('sprints_started_by_fk');
    const ended = { endedAt: new Date('2026-11-16T09:00:00Z'), endedBy: theirs.id };
    expect(await constraint(insertSprint(flow, ended))).toBe('sprints_ended_by_fk');
  });
});
