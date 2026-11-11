import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Company,
  type Flow,
  type FlowStep,
  flowSteps,
  flows,
  type NewFlowStep,
  type Principal,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertPrincipal, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let lead: Principal;
let coder: Principal;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  lead = await insertPrincipal(handle, acme.id, 'agent');
  coder = await insertPrincipal(handle, acme.id, 'agent');
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

async function insertFlow(leadId: string, values: Partial<typeof flows.$inferInsert> = {}): Promise<Flow> {
  const [row] = await handle.db
    .insert(flows)
    .values({ companyId: acme.id, leadPrincipalId: leadId, name: 'Delivery', createdBy: leadId, ...values })
    .returning();
  if (!row) throw new Error('no flow returned');
  return row;
}

async function insertStep(flow: Flow, values: Partial<NewFlowStep> = {}): Promise<FlowStep> {
  const [row] = await handle.db
    .insert(flowSteps)
    .values({
      companyId: flow.companyId,
      flowId: flow.id,
      position: 1,
      name: 'Develop',
      kind: 'work',
      assigneePrincipalId: coder.id,
      ...values,
    })
    .returning();
  if (!row) throw new Error('no step returned');
  return row;
}

describe('flows', () => {
  it('stores one flow per lead, named 1 to 80 characters', async () => {
    const owner = await insertPrincipal(handle, acme.id);
    const flow = await insertFlow(owner.id);
    expect(flow).toMatchObject({ leadPrincipalId: owner.id, name: 'Delivery', createdBy: owner.id });
    expect(await constraint(insertFlow(owner.id))).toBe('flows_lead_unique');
    const other = await insertPrincipal(handle, acme.id);
    expect(await constraint(insertFlow(other.id, { name: '' }))).toBe('flows_name_check');
    expect(await constraint(insertFlow(other.id, { name: 'x'.repeat(81) }))).toBe('flows_name_check');
  });

  it("refuses a lead or a creator of another company, and an unknown company's", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await constraint(insertFlow(theirs.id))).toBe('flows_lead_fk');
    const mine = await insertPrincipal(handle, acme.id);
    expect(await constraint(insertFlow(mine.id, { createdBy: theirs.id }))).toBe('flows_created_by_fk');
    expect(await constraint(insertFlow(mine.id, { companyId: MISSING_ID }))).toBe(
      'flows_company_id_companies_id_fk',
    );
  });
});

describe('flow_steps', () => {
  it('stores a step with its defaults: manual start, keep, no send-back', async () => {
    const flow = await insertFlow(lead.id);
    expect(await insertStep(flow)).toMatchObject({
      position: 1,
      kind: 'work',
      starts: 'manual',
      onReturn: 'keep',
      sendsBackToStepId: null,
      sendBackLimit: null,
    });
  });

  it('keeps positions unique in a flow, from 1, and names 1 to 60 characters', async () => {
    const flow = await insertFlow(await principalId());
    await insertStep(flow);
    expect(await constraint(insertStep(flow, { name: 'Again' }))).toBe('flow_steps_position_unique');
    expect(await constraint(insertStep(flow, { position: 0 }))).toBe('flow_steps_position_check');
    expect(await constraint(insertStep(flow, { position: 2, name: '' }))).toBe('flow_steps_name_check');
    expect(await constraint(insertStep(flow, { position: 2, name: 'n'.repeat(61) }))).toBe(
      'flow_steps_name_check',
    );
  });

  it('refuses an unknown kind, start or return', async () => {
    const flow = await insertFlow(await principalId());
    expect(await constraint(insertStep(flow, { kind: 'review' as never }))).toBe('flow_steps_kind_check');
    expect(await constraint(insertStep(flow, { starts: 'now' as never }))).toBe('flow_steps_starts_check');
    expect(await constraint(insertStep(flow, { onReturn: 'drop' as never }))).toBe(
      'flow_steps_on_return_check',
    );
  });

  it('gives a send-back target and a limit to Check and Sign-off steps only, never itself', async () => {
    const flow = await insertFlow(await principalId());
    const develop = await insertStep(flow);
    const review = await insertStep(flow, {
      position: 2,
      name: 'Review',
      kind: 'check',
      sendsBackToStepId: develop.id,
      sendBackLimit: 3,
    });
    expect(review).toMatchObject({ sendsBackToStepId: develop.id, sendBackLimit: 3 });
    await insertStep(flow, { position: 3, name: 'Approve', kind: 'signoff', sendsBackToStepId: develop.id });
    expect(
      await constraint(insertStep(flow, { position: 4, name: 'W', sendsBackToStepId: develop.id })),
    ).toBe('flow_steps_send_back_check');
    expect(await constraint(insertStep(flow, { position: 4, name: 'W', sendBackLimit: 2 }))).toBe(
      'flow_steps_limit_check',
    );
    const check = { position: 4, name: 'C', kind: 'check' as const };
    expect(await constraint(insertStep(flow, { ...check, sendBackLimit: 0 }))).toBe('flow_steps_limit_check');
    expect(await constraint(insertStep(flow, { ...check, sendBackLimit: 100 }))).toBe(
      'flow_steps_limit_check',
    );
    const self = handle.db
      .update(flowSteps)
      .set({ sendsBackToStepId: review.id })
      .where(eq(flowSteps.id, review.id));
    expect(await constraint(self)).toBe('flow_steps_send_back_check');
  });

  it("refuses another company's flow, assignee or target", async () => {
    const flow = await insertFlow(await principalId());
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await constraint(insertStep(flow, { assigneePrincipalId: theirs.id }))).toBe(
      'flow_steps_assignee_fk',
    );
    expect(await constraint(insertStep(flow, { companyId: globex.id, assigneePrincipalId: theirs.id }))).toBe(
      'flow_steps_flow_fk',
    );
    const theirFlow = (
      await handle.db
        .insert(flows)
        .values({ companyId: globex.id, leadPrincipalId: theirs.id, name: 'G', createdBy: theirs.id })
        .returning()
    )[0] as Flow;
    const theirStep = await insertStep(theirFlow, { assigneePrincipalId: theirs.id });
    const crossTarget = { position: 2, name: 'R', kind: 'check' as const, sendsBackToStepId: theirStep.id };
    expect(await constraint(insertStep(flow, crossTarget))).toBe('flow_steps_sends_back_to_fk');
  });
});

/** A new principal of Acme, to lead a flow of its own. */
async function principalId(): Promise<string> {
  return (await insertPrincipal(handle, acme.id)).id;
}
