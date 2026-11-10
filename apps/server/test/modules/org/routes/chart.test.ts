import { getJson, LEVEL, seedAgent, seedMember } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call } from '../../../fixtures/companies/companies.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import {
  agentsPath,
  chartPath,
  makeAgent,
  type OrgChartView,
  placedMember,
  positionPath,
  seedProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, addPerson, authWorld } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

type Tree = OrgChartView['tree'];
/** A tree as `[principalId, orphan, children]`, so a whole tree reads in one line. */
const shape = (tree: Tree): unknown[] =>
  tree.map((node) => [node.principalId, node.orphan, shape(node.children)]);

const chartOf = async (person: Parameters<typeof as>[1], company: { companyId: string }) => {
  const res = await as(w, person)('GET', chartPath(company));
  expect(res.status).toBe(200);
  return res.body as OrgChartView;
};

describe('GET /api/companies/:companyId/org/chart', () => {
  it('shows every active member and every agent not archived, with their display data, and the tree', async () => {
    const company = await membersCompany(w);
    const admin = await placedMember(w, company, 'admin');
    const viewer = await placedMember(w, company, 'viewer', { reportsTo: admin.principalId });
    await as(w, company.owner)('PUT', positionPath(company, admin.principalId), { title: 'CTO' });
    const work = await seedProfile(w.t.db, admin.userId, {
      name: 'Work',
      model: 'claude-opus-5-5',
      effort: 'xhigh',
    });
    const lead = await makeAgent(w, company, admin, { name: 'Lead', profileId: work.id });
    const coder = await makeAgent(w, company, admin, {
      name: 'Coder',
      reportsToPrincipalId: lead.principalId,
    });
    const paused = await makeAgent(w, company, company.owner, { name: 'Napper' });
    await as(w, company.owner)('PATCH', agentsPath(company, paused.id), { status: 'paused' });
    const archived = await makeAgent(w, company, company.owner, { name: 'Gone' });
    await as(w, company.owner)('PATCH', agentsPath(company, archived.id), { status: 'archived' });
    await placedMember(w, company, 'member', { status: 'removed' });
    // An active member with no place yet (S2.4 places newcomers) is not on the chart either.
    await addPerson(w.t.db, w.fake, company.companyId, { role: 'member' });

    const chart = await chartOf(viewer, company);
    const owner = company.owner;
    expect(chart.nodes).toEqual([
      {
        principalId: owner.principalId,
        kind: 'person',
        reportsTo: null,
        title: null,
        person: {
          userId: owner.userId,
          displayName: `Owner ${owner.subject}`,
          email: `${owner.subject}@owners.test`,
          imageUrl: null,
          role: 'owner',
        },
      },
      {
        principalId: admin.principalId,
        kind: 'person',
        reportsTo: owner.principalId,
        title: 'CTO',
        person: {
          userId: admin.userId,
          displayName: admin.subject,
          email: `${admin.subject}@people.test`,
          imageUrl: null,
          role: 'admin',
        },
      },
      expect.objectContaining({
        principalId: viewer.principalId,
        kind: 'person',
        person: expect.objectContaining({ role: 'viewer' }),
      }),
      {
        principalId: lead.principalId,
        kind: 'agent',
        reportsTo: admin.principalId,
        title: null,
        agent: {
          agentId: lead.id,
          name: 'Lead',
          slug: lead.slug,
          roleTitle: 'Coder',
          status: 'active',
          face: lead.face,
          profile: {
            id: work.id,
            name: 'Work',
            provider: 'claude',
            ownerUserId: admin.userId,
            ownerName: admin.subject,
          },
          runsWith: { model: 'claude-opus-5-5', effort: 'xhigh', provider: 'claude' },
          placement: null,
        },
      },
      expect.objectContaining({
        principalId: coder.principalId,
        reportsTo: lead.principalId,
        agent: expect.objectContaining({ profile: null, runsWith: null }),
      }),
      expect.objectContaining({
        principalId: paused.principalId,
        agent: expect.objectContaining({ status: 'paused' }),
      }),
    ]);
    expect(shape(chart.tree)).toEqual([
      [
        owner.principalId,
        false,
        [
          [
            admin.principalId,
            false,
            [
              [viewer.principalId, false, []],
              [lead.principalId, false, [[coder.principalId, false, []]]],
            ],
          ],
          [paused.principalId, false, []],
        ],
      ],
    ]);
    expect(chart.tree[0]?.kind).toBe('person');
    expect(chart.tree[0]?.children[0]?.children[1]?.kind).toBe('agent');
  });

  it("shows a person's photo, and no name for a person who has not given one (the web shows the email)", async () => {
    const company = await membersCompany(w);
    const ann = await seedMember(w.t.db, company.companyId, {
      displayName: null,
      email: 'ann@photos.test',
      imageUrl: 'https://img.test/ann.png',
      reportsTo: company.owner.principalId,
    });
    const chart = await chartOf(company.owner, company);
    expect(chart.nodes.find((node) => node.principalId === ann.principal.id)).toEqual({
      principalId: ann.principal.id,
      kind: 'person',
      reportsTo: company.owner.principalId,
      title: null,
      person: {
        userId: ann.user.id,
        displayName: null,
        email: 'ann@photos.test',
        imageUrl: 'https://img.test/ann.png',
        role: 'member',
      },
    });
  });

  it('still answers a chart that breaks its invariants, orphans flagged, and logs it once', async () => {
    const company = await membersCompany(w);
    const gone = await placedMember(w, company, 'member', { status: 'removed' });
    const orphan = await seedAgent(w.t.db, company.companyId, { reportsTo: gone.principalId });
    const below = await seedAgent(w.t.db, company.companyId, { reportsTo: orphan.principal.id });
    const warnings = () =>
      w.t.logs.filter((line) => line.level === LEVEL.warn && line.companyId === company.companyId);
    const chart = await chartOf(company.owner, company);
    expect(shape(chart.tree)).toEqual([
      [company.owner.principalId, false, []],
      [orphan.principal.id, true, [[below.principal.id, false, []]]],
    ]);
    await chartOf(company.owner, company);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatchObject({
      msg: 'the org chart breaks its invariants',
      violations: [
        { code: 'unknown_manager', principalId: orphan.principal.id },
        { code: 'chain_without_person', principalId: orphan.principal.id },
        { code: 'chain_without_person', principalId: below.principal.id },
      ],
    });
    // Mended, it is quiet; broken again later, it is logged again.
    await as(w, company.owner)('PUT', positionPath(company, orphan.principal.id), {
      reportsToPrincipalId: company.owner.principalId,
    });
    expect(shape((await chartOf(company.owner, company)).tree)).toEqual([
      [company.owner.principalId, false, [[orphan.principal.id, false, [[below.principal.id, false, []]]]]],
    ]);
    await seedAgent(w.t.db, company.companyId, { reportsTo: gone.principalId });
    await chartOf(company.owner, company);
    expect(warnings()).toHaveLength(2);
  });

  it('answers 401 without a credential and 404 in another company', async () => {
    const company = await membersCompany(w);
    expect((await call(w, undefined)('GET', chartPath(company))).status).toBe(401);
    expect(await as(w, company.owner)('GET', chartPath(await membersCompany(w)))).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });
});

describe('the org routes in the OpenAPI document', () => {
  it('lists each route with the bearer scheme and its refusals', async () => {
    const doc = (await getJson(w.t.app, '/api/openapi.json')).body as {
      paths: Record<string, Record<string, { security?: unknown; responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, unknown> };
    };
    const codes = (path: string, method: string) => Object.keys(doc.paths[path]?.[method]?.responses ?? {});
    const agents = '/api/companies/{companyId}/agents';
    expect(codes(agents, 'get')).toEqual(['200', '400', '401', '404']);
    expect(codes(agents, 'post')).toEqual(['201', '400', '401', '403', '404', '409', '422']);
    expect(codes(`${agents}/{agentId}`, 'get')).toEqual(['200', '401', '404']);
    expect(codes(`${agents}/{agentId}`, 'patch')).toEqual(['200', '400', '401', '403', '404', '409', '422']);
    expect(codes('/api/companies/{companyId}/org/positions/{principalId}', 'put')).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '422',
    ]);
    expect(codes('/api/companies/{companyId}/org/chart', 'get')).toEqual(['200', '401', '404']);
    expect(doc.paths[agents]?.post?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining([
        'Agent',
        'AgentDetail',
        'CreateAgent',
        'OrgChart',
        'OrgTreeNode',
        'PersonNode',
        'AgentNode',
      ]),
    );
  });
});
