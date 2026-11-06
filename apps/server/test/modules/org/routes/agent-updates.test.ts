import { seedAgent } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call } from '../../../fixtures/companies/companies.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import {
  type AgentDetailView,
  agentsPath,
  auditRows,
  auditTrail,
  chartPath,
  makeAgent,
  type OrgChartView,
  placedMember,
  placeOf,
  positionPath,
  unplace,
} from '../../../fixtures/org.ts';
import { type AuthWorld, addPerson, authWorld } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const patch =
  (person: Parameters<typeof as>[1], company: { companyId: string }, id: string, requestId?: string) =>
  (body: unknown) =>
    as(w, person, requestId)('PATCH', agentsPath(company, id), body);

describe('PATCH /api/companies/:companyId/agents/:agentId', () => {
  it('writes only the fields that change, one audit row each', async () => {
    const company = await membersCompany(w);
    const agent = await makeAgent(w, company, company.owner, { name: 'SLOP BOX', maxConcurrentRuns: 2 });
    const res = await patch(
      company.owner,
      company,
      agent.id,
      'req-patch-1',
    )({
      name: 'SLOP BOX 2',
      slug: 'slop-box-two',
      roleTitle: 'Senior Coder',
      model: 'claude-fable-5',
      effort: 'max',
      harness: 'codex',
      maxConcurrentRuns: 2,
      face: 3,
    });
    expect(res).toMatchObject({
      status: 200,
      body: {
        id: agent.id,
        name: 'SLOP BOX 2',
        slug: 'slop-box-two',
        roleTitle: 'Senior Coder',
        model: 'claude-fable-5',
        effort: 'max',
        harness: 'codex',
        maxConcurrentRuns: 2,
        face: 3,
        instructionsRev: 1,
        reportsTo: company.owner.principalId,
      },
    });
    const rows = (await auditRows(w.t.db, 'agent', agent.id)).filter((row) => row.action === 'update');
    expect(rows.map((row) => [row.field, row.oldValue, row.newValue])).toEqual([
      ['effort', 'high', 'max'],
      ['face', agent.face, 3],
      ['harness', 'claude_code', 'codex'],
      ['model', 'claude-opus-5-5', 'claude-fable-5'],
      ['name', 'SLOP BOX', 'SLOP BOX 2'],
      ['roleTitle', 'Coder', 'Senior Coder'],
      ['slug', 'slop-box', 'slop-box-two'],
    ]);
    expect(
      rows.every(
        (row) => row.requestId === 'req-patch-1' && row.actorPrincipalId === company.owner.principalId,
      ),
    ).toBe(true);
    // The same values again change nothing and write nothing.
    const again = await patch(
      company.owner,
      company,
      agent.id,
    )({ name: 'SLOP BOX 2', face: 3, slug: 'slop-box-two' });
    expect(again).toMatchObject({ status: 200, body: { name: 'SLOP BOX 2' } });
    expect(
      (await auditRows(w.t.db, 'agent', agent.id)).filter((row) => row.action === 'update'),
    ).toHaveLength(7);
  });

  it('bumps instructionsRev when the instructions change, and audits the revision, never the text', async () => {
    const company = await membersCompany(w);
    const agent = await makeAgent(w, company, company.owner, { instructions: 'v1' });
    const first = await patch(company.owner, company, agent.id)({ instructions: 'v2: the secret plan' });
    expect(first).toMatchObject({
      status: 200,
      body: { instructions: 'v2: the secret plan', instructionsRev: 2 },
    });
    const same = await patch(company.owner, company, agent.id)({ instructions: 'v2: the secret plan' });
    expect(same).toMatchObject({ status: 200, body: { instructionsRev: 2 } });
    const third = await patch(company.owner, company, agent.id)({ instructions: '' });
    expect(third).toMatchObject({ status: 200, body: { instructions: '', instructionsRev: 3 } });
    const trail = await auditTrail(w.t.db, 'agent', agent.id);
    expect(trail.filter(([action]) => action === 'update')).toEqual([
      ['update', 'instructionsRev', 1, 2],
      ['update', 'instructionsRev', 2, 3],
    ]);
    expect(JSON.stringify(trail)).not.toContain('secret plan');
  });

  it('refuses a slug another agent has (archived ones too) with 409, and keeps its own', async () => {
    const company = await membersCompany(w);
    const agent = await makeAgent(w, company, company.owner, { name: 'Mine' });
    await seedAgent(w.t.db, company.companyId, { reportsTo: null, slug: 'old-one', status: 'archived' });
    await makeAgent(w, company, company.owner, { name: 'Taken' });
    for (const slug of ['taken', 'old-one']) {
      expect(await patch(company.owner, company, agent.id)({ slug })).toMatchObject({
        status: 409,
        body: { error: { code: 'agent_slug_taken' } },
      });
    }
    expect(await patch(company.owner, company, agent.id)({ slug: 'mine' })).toMatchObject({
      status: 200,
      body: { slug: 'mine' },
    });
  });

  it('pauses and resumes an agent, which keeps its place', async () => {
    const company = await membersCompany(w);
    const agent = await makeAgent(w, company, company.owner);
    expect(await patch(company.owner, company, agent.id)({ status: 'paused' })).toMatchObject({
      status: 200,
      body: { status: 'paused', reportsTo: company.owner.principalId },
    });
    expect(await patch(company.owner, company, agent.id)({ status: 'active' })).toMatchObject({
      status: 200,
      body: { status: 'active', reportsTo: company.owner.principalId },
    });
    expect(await placeOf(w.t.db, company.companyId, agent.principalId)).toEqual([
      company.owner.principalId,
      null,
    ]);
    expect((await auditTrail(w.t.db, 'agent', agent.id)).filter(([action]) => action === 'update')).toEqual([
      ['update', 'status', 'active', 'paused'],
      ['update', 'status', 'paused', 'active'],
    ]);
  });

  it('refuses an empty or ill-fitting body (400), roles below admin (403), others (401, 404)', async () => {
    const company = await membersCompany(w);
    const agent = await makeAgent(w, company, company.owner);
    for (const body of [
      {},
      { color: 'red' },
      { status: 'deleted' },
      { name: '' },
      { maxConcurrentRuns: 9 },
    ]) {
      expect(await patch(company.owner, company, agent.id)(body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    for (const role of ['member', 'viewer'] as const) {
      const person = await placedMember(w, company, role);
      expect(await patch(person, company, agent.id)({ name: 'Mine now' })).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    expect((await call(w, undefined)('PATCH', agentsPath(company, agent.id), { name: 'X' })).status).toBe(
      401,
    );
    const other = await membersCompany(w);
    const theirs = await makeAgent(w, other, other.owner);
    expect(await patch(company.owner, company, theirs.id)({ name: 'X' })).toMatchObject({
      status: 404,
      body: { error: { code: 'agent_not_found' } },
    });
    expect(await patch(company.owner, other, theirs.id)({ name: 'X' })).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });
});

describe('archiving and restoring an agent', () => {
  it('moves its reports up to its manager and takes it off the chart', async () => {
    const company = await membersCompany(w);
    const lead = await placedMember(w, company, 'admin');
    const archived = await makeAgent(w, company, lead, { name: 'Middle' });
    await as(w, company.owner)('PUT', positionPath(company, archived.principalId), { title: 'Team lead' });
    const left = await makeAgent(w, company, lead, {
      name: 'Left',
      reportsToPrincipalId: archived.principalId,
    });
    const right = await makeAgent(w, company, lead, {
      name: 'Right',
      reportsToPrincipalId: archived.principalId,
    });
    const res = await patch(company.owner, company, archived.id, 'req-archive')({ status: 'archived' });
    expect(res).toMatchObject({ status: 200, body: { status: 'archived', reportsTo: null, title: null } });
    for (const report of [left, right]) {
      expect(await placeOf(w.t.db, company.companyId, report.principalId)).toEqual([lead.principalId, null]);
      expect(await auditTrail(w.t.db, 'org_position', report.principalId)).toEqual([
        ['create', 'reportsToPrincipalId', null, archived.principalId],
        ['update', 'reportsToPrincipalId', archived.principalId, lead.principalId],
      ]);
    }
    expect(await placeOf(w.t.db, company.companyId, archived.principalId)).toBeUndefined();
    expect(await auditTrail(w.t.db, 'org_position', archived.principalId)).toEqual([
      ['create', 'reportsToPrincipalId', null, lead.principalId],
      ['update', 'title', null, 'Team lead'],
      ['delete', 'reportsToPrincipalId', lead.principalId, null],
      ['delete', 'title', 'Team lead', null],
    ]);
    expect((await auditRows(w.t.db, 'agent', archived.id)).at(-1)).toMatchObject({
      action: 'update',
      field: 'status',
      oldValue: 'active',
      newValue: 'archived',
      requestId: 'req-archive',
    });
    const chart = (await as(w, company.owner)('GET', chartPath(company))).body as OrgChartView;
    expect(chart.nodes.map((node) => node.principalId)).not.toContain(archived.principalId);
    expect(chart.tree.every((top) => !top.orphan)).toBe(true);
    // Already archived: nothing moves again.
    expect(
      await patch(company.owner, company, archived.id)({ status: 'archived', name: 'Old middle' }),
    ).toMatchObject({
      status: 200,
      body: { status: 'archived', name: 'Old middle', reportsTo: null },
    });
  });

  it('moves agents under an archived agent up to the agent above it', async () => {
    const company = await membersCompany(w);
    const top = await makeAgent(w, company, company.owner, { name: 'Top' });
    const middle = await makeAgent(w, company, company.owner, {
      name: 'Mid',
      reportsToPrincipalId: top.principalId,
    });
    const low = await makeAgent(w, company, company.owner, {
      name: 'Low',
      reportsToPrincipalId: middle.principalId,
    });
    expect((await patch(company.owner, company, middle.id)({ status: 'archived' })).status).toBe(200);
    expect(await placeOf(w.t.db, company.companyId, low.principalId)).toEqual([top.principalId, null]);
    // An agent with no place (left so by hand) archives with nothing to move or remove.
    const loose = await seedAgent(w.t.db, company.companyId, { reportsTo: null });
    expect(await patch(company.owner, company, loose.agent.id)({ status: 'archived' })).toMatchObject({
      status: 200,
      body: { status: 'archived', reportsTo: null },
    });
    expect(await auditTrail(w.t.db, 'org_position', loose.principal.id)).toEqual([]);
  });

  it('gives the company’s earliest active owner the agents nobody above can take', async () => {
    const company = await membersCompany(w);
    const later = await placedMember(w, company, 'owner');
    const gone = await placedMember(w, company, 'member', {
      status: 'removed',
      reportsTo: later.principalId,
    });
    // An agent whose manager left (a removed member's agent), with an agent of its own.
    const orphan = await seedAgent(w.t.db, company.companyId, { reportsTo: gone.principalId });
    const report = await seedAgent(w.t.db, company.companyId, { reportsTo: orphan.principal.id });
    expect((await patch(later, company, orphan.agent.id)({ status: 'archived' })).status).toBe(200);
    expect(await placeOf(w.t.db, company.companyId, report.principal.id)).toEqual([
      company.owner.principalId,
      null,
    ]);
  });

  it('refuses with 422, changing nothing, when the chart afterwards would break an invariant it did not', async () => {
    const company = await membersCompany(w);
    const gone = await placedMember(w, company, 'member', { status: 'removed' });
    const orphan = await seedAgent(w.t.db, company.companyId, { reportsTo: gone.principalId });
    const report = await seedAgent(w.t.db, company.companyId, { reportsTo: orphan.principal.id });
    // The earliest owner has no place on the chart, so nobody could take the report: it would be left at the top.
    await unplace(w.t.db, company.companyId, company.owner.principalId);
    const admin = await placedMember(w, company, 'admin', { reportsTo: null });
    expect(
      await patch(admin, company, orphan.agent.id)({ status: 'archived', name: 'Renamed' }),
    ).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'agent_root',
          message: 'This agent reports to nobody; only people can be at the top of the chart.',
        },
      },
    });
    expect(await as(w, admin)('GET', agentsPath(company, orphan.agent.id))).toMatchObject({
      body: { status: 'active', name: orphan.agent.name, reportsTo: gone.principalId },
    });
    expect(await placeOf(w.t.db, company.companyId, report.principal.id)).toEqual([
      orphan.principal.id,
      null,
    ]);
  });

  it('brings an archived agent back under whoever restores it, paused or active', async () => {
    const company = await membersCompany(w);
    const agent = await makeAgent(w, company, company.owner);
    await patch(company.owner, company, agent.id)({ status: 'archived' });
    const admin = await placedMember(w, company, 'admin');
    const res = await patch(admin, company, agent.id, 'req-restore')({ status: 'active' });
    expect(res).toMatchObject({
      status: 200,
      body: { status: 'active', reportsTo: admin.principalId, title: null },
    });
    expect(await auditTrail(w.t.db, 'org_position', agent.principalId)).toEqual([
      ['create', 'reportsToPrincipalId', null, company.owner.principalId],
      ['delete', 'reportsToPrincipalId', company.owner.principalId, null],
      ['create', 'reportsToPrincipalId', null, admin.principalId],
    ]);
    await patch(admin, company, agent.id)({ status: 'archived' });
    expect(await patch(company.owner, company, agent.id)({ status: 'paused' })).toMatchObject({
      status: 200,
      body: { status: 'paused', reportsTo: company.owner.principalId },
    });
    const chart = (await as(w, admin)('GET', chartPath(company))).body as OrgChartView;
    expect(chart.nodes.find((node) => node.principalId === agent.principalId)).toMatchObject({
      reportsTo: company.owner.principalId,
    });
  });

  it('refuses to restore under a caller who has no place on the chart (422)', async () => {
    const company = await membersCompany(w);
    const agent: AgentDetailView = await makeAgent(w, company, company.owner);
    await patch(company.owner, company, agent.id)({ status: 'archived' });
    const unplaced = await addPerson(w.t.db, w.fake, company.companyId, { role: 'admin' });
    expect(await patch(unplaced, company, agent.id)({ status: 'active' })).toMatchObject({
      status: 422,
      body: { error: { code: 'unknown_principal' } },
    });
    expect(await placeOf(w.t.db, company.companyId, agent.principalId)).toBeUndefined();
  });
});
