import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { inboxOf, rowsOf, textsOf } from '../../../fixtures/notifications.ts';
import { agentsPath, makeAgent, placedMember } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

// Pausing, resuming and archiving an agent tell the manager it reported to (S2.9), unless they did it themselves;
// agents hear of nothing.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const setStatus = async (company: MembersCompany, by: Person, agentId: string, status: string) => {
  const res = await as(w, by)('PATCH', agentsPath(company, agentId), { status });
  expect(res.status).toBe(200);
};

describe('an agent paused, resumed or archived', () => {
  it('tells its manager, with a link to the agent’s page, and not the owner who did it', async () => {
    const company = await membersCompany(w);
    const anna = await placedMember(w, company, 'admin');
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Night Shift',
      reportsToPrincipalId: anna.principalId,
    });
    await setStatus(company, company.owner, agent.id, 'paused');
    await setStatus(company, company.owner, agent.id, 'active');
    await setStatus(company, company.owner, agent.id, 'archived');
    expect(await textsOf(w, company, anna)).toEqual([
      'Night Shift, an agent reporting to you, was archived',
      'Night Shift, an agent reporting to you, was resumed',
      'Night Shift, an agent reporting to you, was paused',
    ]);
    const [archived] = (await inboxOf(w, company, anna)).notifications;
    expect(archived).toMatchObject({ kind: 'agent_archived', path: `agents/${agent.slug}` });
    expect(await textsOf(w, company, company.owner)).toEqual([]);
    // Back from the archive it reports to the one who restored it: nobody else to tell.
    await setStatus(company, company.owner, agent.id, 'active');
    expect(await rowsOf(w.t.db, company.companyId)).toHaveLength(3);
  });

  it('tells nobody when the manager did it, or when the manager is an agent', async () => {
    const company = await membersCompany(w);
    const lead = await makeAgent(w, company, company.owner, { name: 'Lead' });
    const helper = await makeAgent(w, company, company.owner, {
      name: 'Helper',
      reportsToPrincipalId: lead.principalId,
    });
    await setStatus(company, company.owner, lead.id, 'paused');
    await setStatus(company, company.owner, helper.id, 'paused');
    expect(await rowsOf(w.t.db, company.companyId)).toEqual([]);
  });

  it('moves an archived agent’s reports up and tells them and their new manager', async () => {
    const company = await membersCompany(w);
    const anna = await placedMember(w, company, 'admin');
    const lead = await makeAgent(w, company, anna, { name: 'Lead' });
    const helper = await makeAgent(w, company, anna, {
      name: 'Helper',
      reportsToPrincipalId: lead.principalId,
    });
    await setStatus(company, company.owner, lead.id, 'archived');
    expect(await rowsOf(w.t.db, company.companyId)).toEqual([
      [anna.principalId, 'report_added', company.owner.principalId],
      [anna.principalId, 'agent_archived', company.owner.principalId],
    ]);
    expect(await textsOf(w, company, anna)).toEqual([
      'Lead, an agent reporting to you, was archived',
      'Helper now reports to you',
    ]);
    expect(helper.principalId).not.toBe(anna.principalId);
  });
});
