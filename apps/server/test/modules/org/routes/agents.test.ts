import { principals } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { agentFace } from '@mwc/shared/org';
import { seedAgent } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuthWorld, authWorld, seedApiKey } from '../../../fixtures/auth.ts';
import { call } from '../../../fixtures/companies.ts';
import { addMember, as, membersCompany } from '../../../fixtures/members.ts';
import {
  type AgentDetailView,
  agentsPath,
  auditRows,
  auditTrail,
  makeAgent,
  placedMember,
  placeOf,
} from '../../../fixtures/org.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const AUDITED = [
  'effort',
  'face',
  'harness',
  'instructionsRev',
  'maxConcurrentRuns',
  'model',
  'name',
  'principalId',
  'roleTitle',
  'slug',
  'status',
] as const;

const listed = (body: unknown) => (body as { agents: Array<Record<string, unknown>> }).agents;

describe('POST /api/companies/:companyId/agents', () => {
  it('creates an agent under the caller with the defaults, and audits the agent and its place', async () => {
    const company = await membersCompany(w);
    const admin = await placedMember(w, company, 'admin');
    const res = await as(w, admin, 'req-agent-1')('POST', agentsPath(company), {
      name: '  SLOP BOX ',
      roleTitle: ' Coder ',
    });
    expect(res.status).toBe(201);
    const agent = res.body as AgentDetailView;
    expect(agent).toEqual({
      id: agent.id,
      principalId: agent.principalId,
      name: 'SLOP BOX',
      slug: 'slop-box',
      roleTitle: 'Coder',
      status: 'active',
      harness: 'claude_code',
      model: 'claude-opus-5-5',
      effort: 'high',
      instructionsRev: 1,
      maxConcurrentRuns: 1,
      face: agentFace('slop-box'),
      reportsTo: admin.principalId,
      title: null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      instructions: '',
    });
    const [principal] = await rawDb(w.t.db)
      .select()
      .from(principals)
      .where(eq(principals.id, agent.principalId));
    expect(principal).toMatchObject({ companyId: company.companyId, kind: 'agent' });
    expect(await placeOf(w.t.db, company.companyId, agent.principalId)).toEqual([admin.principalId, null]);
    const values: Record<string, unknown> = { ...agent, principalId: agent.principalId };
    expect(await auditRows(w.t.db, 'agent', agent.id)).toEqual(
      AUDITED.map((field) => ({
        companyId: company.companyId,
        actorKind: 'user',
        actorPrincipalId: admin.principalId,
        requestId: 'req-agent-1',
        entityType: 'agent',
        entityId: agent.id,
        action: 'create',
        field,
        oldValue: null,
        newValue: values[field],
      })),
    );
    expect(await auditTrail(w.t.db, 'org_position', agent.principalId)).toEqual([
      ['create', 'reportsToPrincipalId', null, admin.principalId],
    ]);
  });

  it('takes every field it is given, an agent as its manager too', async () => {
    const company = await membersCompany(w);
    const lead = await makeAgent(w, company, company.owner, { name: 'Lead' });
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Reviewer',
      slug: 'code-reviewer',
      roleTitle: 'Code Reviewer',
      model: 'claude-fable-5',
      effort: 'xhigh',
      harness: 'codex',
      instructions: 'Review every change.',
      maxConcurrentRuns: 8,
      face: 41,
      reportsToPrincipalId: lead.principalId,
    });
    expect(agent).toMatchObject({
      slug: 'code-reviewer',
      roleTitle: 'Code Reviewer',
      model: 'claude-fable-5',
      effort: 'xhigh',
      harness: 'codex',
      instructions: 'Review every change.',
      instructionsRev: 1,
      maxConcurrentRuns: 8,
      face: 41,
      reportsTo: lead.principalId,
    });
    expect((await makeAgent(w, company, company.owner, { name: 'Zero', face: 0 })).face).toBe(0);
  });

  it('derives the slug from the name, with -2, -3 when taken (by archived agents too), and keeps the face stable', async () => {
    const company = await membersCompany(w);
    await seedAgent(w.t.db, company.companyId, { reportsTo: null, slug: 'slop-box', status: 'archived' });
    const second = await makeAgent(w, company, company.owner);
    const third = await makeAgent(w, company, company.owner);
    expect([second.slug, third.slug]).toEqual(['slop-box-2', 'slop-box-3']);
    expect([second.face, third.face]).toEqual([agentFace('slop-box-2'), agentFace('slop-box-3')]);
    expect((await makeAgent(w, company, company.owner, { name: '!!!' })).slug).toBe('agent');
    const res = await as(w, company.owner)('POST', agentsPath(company), {
      name: 'Other',
      roleTitle: 'Coder',
      slug: 'slop-box-2',
    });
    expect(res).toMatchObject({
      status: 409,
      body: { error: { code: 'agent_slug_taken', message: expect.stringContaining('slop-box-2') } },
    });
    // Another company may use the same slug.
    const elsewhere = await membersCompany(w);
    expect((await makeAgent(w, elsewhere, elsewhere.owner, { slug: 'slop-box-2' })).slug).toBe('slop-box-2');
  });

  it('refuses a place the org rules refuse with 422 and their code, writing nothing', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const gone = await placedMember(w, company, 'member', { status: 'removed' });
    const archived = await seedAgent(w.t.db, company.companyId, { reportsTo: null, status: 'archived' });
    const unplaced = await addMember(w, company, 'admin');
    const post =
      (person = company.owner) =>
      (body: Record<string, unknown>) =>
        as(w, person)('POST', agentsPath(company), { name: 'X', roleTitle: 'Coder', ...body });
    for (const manager of [other.owner.principalId, gone.principalId, archived.principal.id, 'nope']) {
      expect(await post()({ reportsToPrincipalId: manager })).toMatchObject({
        status: 422,
        body: {
          error: {
            code: 'unknown_principal',
            message: "The new manager is not on this company's org chart.",
          },
        },
      });
    }
    // The caller is the manager when none is given: an admin with no place yet has nowhere to put it.
    expect(await post(unplaced)({})).toMatchObject({
      status: 422,
      body: { error: { code: 'unknown_principal' } },
    });
    expect(await post()({ reportsToPrincipalId: null })).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'agent_root',
          message: 'An agent must report to someone; only people can be at the top of the chart.',
        },
      },
    });
    // An agent whose manager left (a removed member's agent) has no person above it to give a new agent.
    const stranded = await seedAgent(w.t.db, company.companyId, { reportsTo: gone.principalId });
    expect(await post()({ reportsToPrincipalId: stranded.principal.id })).toMatchObject({
      status: 422,
      body: { error: { code: 'chain_without_person' } },
    });
    expect(
      listed((await as(w, company.owner)('GET', agentsPath(company, undefined, '?status=all'))).body),
    ).toHaveLength(2);
  });

  it('refuses a body that does not fit (400)', async () => {
    const company = await membersCompany(w);
    for (const body of [
      { roleTitle: 'Coder' },
      { name: '   ', roleTitle: 'Coder' },
      { name: 'x'.repeat(81), roleTitle: 'Coder' },
      { name: 'X' },
      { name: 'X', roleTitle: 'y'.repeat(81) },
      { name: 'X', roleTitle: 'Coder', slug: 'Not A Slug' },
      { name: 'X', roleTitle: 'Coder', model: '' },
      { name: 'X', roleTitle: 'Coder', effort: 'huge' },
      { name: 'X', roleTitle: 'Coder', harness: 'vim' },
      { name: 'X', roleTitle: 'Coder', maxConcurrentRuns: 0 },
      { name: 'X', roleTitle: 'Coder', maxConcurrentRuns: 9 },
      { name: 'X', roleTitle: 'Coder', face: -1 },
      { name: 'X', roleTitle: 'Coder', face: 42 },
      { name: 'X', roleTitle: 'Coder', face: 1.5 },
    ]) {
      expect(await as(w, company.owner)('POST', agentsPath(company), body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    // At the limits, it takes them.
    const edge = await makeAgent(w, company, company.owner, {
      name: 'n'.repeat(80),
      roleTitle: 'r'.repeat(80),
      maxConcurrentRuns: 1,
      face: 0,
    });
    expect(edge.name).toHaveLength(80);
  });

  it('is for admins and owners: 403 below, 401 without a credential, 404 in another company', async () => {
    const company = await membersCompany(w);
    for (const role of ['member', 'viewer'] as const) {
      const person = await placedMember(w, company, role);
      expect(
        await as(w, person)('POST', agentsPath(company), { name: 'X', roleTitle: 'Coder' }),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    expect(
      await call(w, undefined)('POST', agentsPath(company), { name: 'X', roleTitle: 'Coder' }),
    ).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
    const other = await membersCompany(w);
    expect(
      await as(w, company.owner)('POST', agentsPath(other), { name: 'X', roleTitle: 'Coder' }),
    ).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });

  it('works with an API key, as the member who owns it', async () => {
    const company = await membersCompany(w);
    const admin = await placedMember(w, company, 'admin');
    const { key } = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: admin.principalId,
    });
    const res = await call(w, key)('POST', agentsPath(company), { name: 'Keyed', roleTitle: 'Coder' });
    expect(res).toMatchObject({ status: 201, body: { reportsTo: admin.principalId } });
    const agent = res.body as AgentDetailView;
    expect((await auditRows(w.t.db, 'agent', agent.id))[0]).toMatchObject({
      actorPrincipalId: admin.principalId,
    });
    expect((await call(w, key)('GET', agentsPath(company, agent.id))).status).toBe(200);
  });
});

describe('GET /api/companies/:companyId/agents', () => {
  it('lists the agents oldest first without their instructions, the archived ones only when asked', async () => {
    const company = await membersCompany(w);
    const viewer = await placedMember(w, company, 'viewer');
    const first = await makeAgent(w, company, company.owner, { name: 'First', instructions: 'secret plan' });
    const paused = await makeAgent(w, company, company.owner, { name: 'Paused' });
    await as(w, company.owner)('PATCH', agentsPath(company, paused.id), { status: 'paused' });
    const archived = await makeAgent(w, company, company.owner, { name: 'Archived' });
    await as(w, company.owner)('PATCH', agentsPath(company, archived.id), { status: 'archived' });
    const list = async (query = '') => {
      const res = await as(w, viewer)('GET', agentsPath(company, undefined, query));
      expect(res.status).toBe(200);
      return listed(res.body);
    };
    const all = await list();
    expect(all.map((agent) => agent.name)).toEqual(['First', 'Paused']);
    const { instructions: _hidden, ...shown } = first;
    expect(all[0]).toEqual({ ...shown, updatedAt: all[0]?.updatedAt });
    expect(all[0]).not.toHaveProperty('instructions');
    expect((await list('?status=archived')).map((a) => [a.name, a.status, a.reportsTo])).toEqual([
      ['Archived', 'archived', null],
    ]);
    expect((await list('?status=all')).map((a) => a.name)).toEqual(['First', 'Paused', 'Archived']);
    expect((await list('?status=active')).map((a) => a.name)).toEqual(['First']);
    expect((await list('?status=paused')).map((a) => a.name)).toEqual(['Paused']);
    expect((await as(w, viewer)('GET', agentsPath(company, undefined, '?status=gone'))).status).toBe(400);
  });

  it('answers 401 without a credential and 404 in another company', async () => {
    const company = await membersCompany(w);
    expect((await call(w, undefined)('GET', agentsPath(company))).status).toBe(401);
    expect(await as(w, company.owner)('GET', agentsPath(await membersCompany(w)))).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });
});

describe('GET /api/companies/:companyId/agents/:agentId', () => {
  it('shows one agent with its instructions to any member, archived ones too', async () => {
    const company = await membersCompany(w);
    const viewer = await placedMember(w, company, 'viewer');
    const agent = await makeAgent(w, company, company.owner, { instructions: 'Ship it.' });
    expect(await as(w, viewer)('GET', agentsPath(company, agent.id))).toMatchObject({
      status: 200,
      body: agent,
    });
    await as(w, company.owner)('PATCH', agentsPath(company, agent.id), { status: 'archived' });
    expect(await as(w, viewer)('GET', agentsPath(company, agent.id))).toMatchObject({
      status: 200,
      body: { status: 'archived', reportsTo: null, instructions: 'Ship it.' },
    });
  });

  it('answers 404 for an unknown, malformed or other company’s agent, and 401 without a credential', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const theirs = await makeAgent(w, other, other.owner);
    for (const id of [theirs.id, '019a4f0c-0000-7000-8000-000000000000', 'not-an-id']) {
      expect(await as(w, company.owner)('GET', agentsPath(company, id))).toMatchObject({
        status: 404,
        body: { error: { code: 'agent_not_found' } },
      });
    }
    expect(await as(w, company.owner)('GET', agentsPath(other, theirs.id))).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
    expect((await call(w, undefined)('GET', agentsPath(other, theirs.id))).status).toBe(401);
  });
});
