import { seedAgent } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call } from '../../../fixtures/companies/companies.ts';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import {
  agentsPath,
  auditRows,
  auditTrail,
  makeAgent,
  placedMember,
  placeOf,
  positionPath,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person, seedApiKey } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const put =
  (person: Person, company: MembersCompany, principalId: string, requestId?: string) => (body: unknown) =>
    as(w, person, requestId)('PUT', positionPath(company, principalId), body);

describe('PUT /api/companies/:companyId/org/positions/:principalId: moves', () => {
  it('moves people and agents for an admin, and audits the move', async () => {
    const company = await membersCompany(w);
    const admin = await placedMember(w, company, 'admin');
    const member = await placedMember(w, company, 'member');
    expect(
      await put(admin, company, member.principalId, 'req-move')({ reportsToPrincipalId: admin.principalId }),
    ).toEqual(
      expect.objectContaining({
        status: 200,
        body: { principalId: member.principalId, reportsTo: admin.principalId, title: null },
      }),
    );
    expect(await auditRows(w.t.db, 'org_position', member.principalId)).toEqual([
      {
        companyId: company.companyId,
        actorKind: 'user',
        actorPrincipalId: admin.principalId,
        requestId: 'req-move',
        entityType: 'org_position',
        entityId: member.principalId,
        action: 'update',
        field: 'reportsToPrincipalId',
        oldValue: company.owner.principalId,
        newValue: admin.principalId,
      },
    ]);
    const lead = await makeAgent(w, company, admin, { name: 'Lead' });
    const helper = await makeAgent(w, company, admin, { name: 'Helper' });
    expect(
      await put(admin, company, helper.principalId)({ reportsToPrincipalId: lead.principalId }),
    ).toMatchObject({
      status: 200,
      body: { reportsTo: lead.principalId },
    });
    // A person may stand at the top, beside the owner; the same place again writes nothing.
    expect(
      await put(company.owner, company, member.principalId)({ reportsToPrincipalId: null }),
    ).toMatchObject({
      status: 200,
      body: { reportsTo: null },
    });
    expect(
      await put(company.owner, company, member.principalId)({ reportsToPrincipalId: null }),
    ).toMatchObject({
      status: 200,
    });
    expect(await auditTrail(w.t.db, 'org_position', member.principalId)).toHaveLength(2);
  });

  it('refuses a move the org rules refuse with 422 and their code', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const admin = await placedMember(w, company, 'admin');
    const member = await placedMember(w, company, 'member', { reportsTo: admin.principalId });
    const agent = await makeAgent(w, company, admin);
    const gone = await placedMember(w, company, 'member', { status: 'removed' });
    const stranded = await seedAgent(w.t.db, company.companyId, { reportsTo: gone.principalId });
    const archived = await seedAgent(w.t.db, company.companyId, { reportsTo: null, status: 'archived' });
    const cases: Array<[string, string | null, string]> = [
      [member.principalId, member.principalId, 'self'],
      [admin.principalId, member.principalId, 'cycle'],
      [agent.principalId, null, 'agent_root'],
      [member.principalId, agent.principalId, 'agent_manages_person'],
      [agent.principalId, stranded.principal.id, 'chain_without_person'],
      [member.principalId, other.owner.principalId, 'unknown_principal'],
      [member.principalId, archived.principal.id, 'unknown_principal'],
      [member.principalId, gone.principalId, 'unknown_principal'],
      [member.principalId, 'not-an-id', 'unknown_principal'],
    ];
    for (const [principalId, reportsToPrincipalId, code] of cases) {
      const res = await put(company.owner, company, principalId)({ reportsToPrincipalId });
      expect(res, `${code}`).toMatchObject({
        status: 422,
        body: { error: { code, message: expect.any(String) } },
      });
    }
    expect(await placeOf(w.t.db, company.companyId, member.principalId)).toEqual([admin.principalId, null]);
    expect(await placeOf(w.t.db, company.companyId, agent.principalId)).toEqual([admin.principalId, null]);
  });

  it('is for admins and owners: a member moving even themselves, or a viewer moving an agent, is 403', async () => {
    const company = await membersCompany(w);
    const member = await placedMember(w, company, 'member');
    const viewer = await placedMember(w, company, 'viewer');
    const agent = await makeAgent(w, company, company.owner);
    for (const [person, target] of [
      [member, member.principalId],
      [member, viewer.principalId],
      [viewer, agent.principalId],
    ] as const) {
      expect(
        await put(person, company, target)({ reportsToPrincipalId: company.owner.principalId }),
      ).toMatchObject({
        status: 403,
        body: {
          error: { code: 'forbidden', message: 'Only an owner or an admin may move people and agents' },
        },
      });
    }
  });
});

describe('PUT /api/companies/:companyId/org/positions/:principalId: titles', () => {
  it('lets any active member title themselves, trimmed, and clear it again', async () => {
    const company = await membersCompany(w);
    const viewer = await placedMember(w, company, 'viewer');
    expect(
      await put(viewer, company, viewer.principalId, 'req-title')({ title: '  Observer ' }),
    ).toMatchObject({
      status: 200,
      body: { principalId: viewer.principalId, reportsTo: company.owner.principalId, title: 'Observer' },
    });
    expect(await put(viewer, company, viewer.principalId)({ title: 'Observer' })).toMatchObject({
      status: 200,
    });
    expect(await put(viewer, company, viewer.principalId)({ title: '' })).toMatchObject({
      body: { title: null },
    });
    await put(viewer, company, viewer.principalId)({ title: 'Back' });
    expect(await put(viewer, company, viewer.principalId)({ title: null })).toMatchObject({
      body: { title: null },
    });
    expect(await auditTrail(w.t.db, 'org_position', viewer.principalId)).toEqual([
      ['update', 'title', null, 'Observer'],
      ['update', 'title', 'Observer', null],
      ['update', 'title', null, 'Back'],
      ['update', 'title', 'Back', null],
    ]);
    expect((await auditRows(w.t.db, 'org_position', viewer.principalId))[0]).toMatchObject({
      actorPrincipalId: viewer.principalId,
      requestId: 'req-title',
    });
  });

  it('lets an admin title anyone, people and agents, with a move in the same call', async () => {
    const company = await membersCompany(w);
    const admin = await placedMember(w, company, 'admin');
    const member = await placedMember(w, company, 'member');
    const agent = await makeAgent(w, company, company.owner);
    expect(
      await put(
        admin,
        company,
        member.principalId,
      )({ title: 'Designer', reportsToPrincipalId: admin.principalId }),
    ).toMatchObject({
      status: 200,
      body: { reportsTo: admin.principalId, title: 'Designer' },
    });
    expect(await auditTrail(w.t.db, 'org_position', member.principalId)).toEqual([
      ['update', 'reportsToPrincipalId', company.owner.principalId, admin.principalId],
      ['update', 'title', null, 'Designer'],
    ]);
    expect(await put(admin, company, agent.principalId)({ title: 'Coder in chief' })).toMatchObject({
      status: 200,
      body: { title: 'Coder in chief' },
    });
    expect(await as(w, member)('GET', agentsPath(company, agent.id))).toMatchObject({
      body: { title: 'Coder in chief', reportsTo: company.owner.principalId },
    });
  });

  it('refuses a member titling someone else (403), and works with a member’s API key on their own title', async () => {
    const company = await membersCompany(w);
    const member = await placedMember(w, company, 'member');
    const agent = await makeAgent(w, company, company.owner);
    for (const target of [company.owner.principalId, agent.principalId]) {
      expect(await put(member, company, target)({ title: 'Boss' })).toMatchObject({
        status: 403,
        body: {
          error: { code: 'forbidden', message: "Only an owner or an admin may set someone else's title" },
        },
      });
    }
    const { key } = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: member.principalId,
    });
    expect(
      await call(w, key)('PUT', positionPath(company, member.principalId), { title: 'Keyed' }),
    ).toMatchObject({
      status: 200,
      body: { title: 'Keyed' },
    });
  });
});

describe('PUT /api/companies/:companyId/org/positions/:principalId: refusals', () => {
  it('answers 404 for anyone not on the chart: another company’s, an inactive member, an archived agent', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const archived = await makeAgent(w, company, company.owner);
    await as(w, company.owner)('PATCH', agentsPath(company, archived.id), { status: 'archived' });
    const inactive = await Promise.all(
      (['removed', 'suspended', 'invited'] as const).map((status) =>
        placedMember(w, company, 'member', { status }),
      ),
    );
    for (const principalId of [
      other.owner.principalId,
      archived.principalId,
      ...inactive.map((person) => person.principalId),
      '019a4f0c-0000-7000-8000-000000000000',
      'not-an-id',
    ]) {
      expect(await put(company.owner, company, principalId)({ title: 'X' })).toMatchObject({
        status: 404,
        body: { error: { code: 'position_not_found' } },
      });
    }
    expect(await put(company.owner, other, other.owner.principalId)({ title: 'X' })).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });

  it('answers 400 for a body that gives nothing or does not fit, and 401 without a credential', async () => {
    const company = await membersCompany(w);
    for (const body of [{}, { title: 'x'.repeat(81) }, { title: 5 }, { reportsToPrincipalId: 7 }]) {
      expect(await put(company.owner, company, company.owner.principalId)(body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    expect(
      await put(company.owner, company, company.owner.principalId)({ title: 't'.repeat(80) }),
    ).toMatchObject({
      status: 200,
    });
    expect(
      (await call(w, undefined)('PUT', positionPath(company, company.owner.principalId), { title: 'X' }))
        .status,
    ).toBe(401);
  });
});
