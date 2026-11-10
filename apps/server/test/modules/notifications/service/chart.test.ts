import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, type MembersCompany, memberPath, membersCompany } from '../../../fixtures/members/members.ts';
import { inboxOf, rowsOf, textsOf } from '../../../fixtures/notifications.ts';
import { makeAgent, placedMember, positionPath } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

// Moves on the org chart notify the moved person, the manager they left and the one they joined (S2.9), never the
// one who moved them and never an agent; the reports a leaver leaves behind hear of their new manager.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const move = async (company: MembersCompany, by: Person, principalId: string, to: string | null) => {
  const res = await as(w, by)('PUT', positionPath(company, principalId), { reportsToPrincipalId: to });
  expect(res.status).toBe(200);
};

/** A company with two admins under the owner and a member under the first admin. */
async function team() {
  const company = await membersCompany(w);
  const anna = await placedMember(w, company, 'admin');
  const bob = await placedMember(w, company, 'admin');
  const mia = await placedMember(w, company, 'member', { reportsTo: anna.principalId });
  return { company, anna, bob, mia };
}

describe('a person moved on the chart', () => {
  it('tells them, the old manager and the new one, each in their words, and not the owner who moved them', async () => {
    const { company, anna, bob, mia } = await team();
    await move(company, company.owner, mia.principalId, bob.principalId);
    const [notice] = (await inboxOf(w, company, mia)).notifications;
    expect(notice).toMatchObject({
      kind: 'manager_changed',
      text: `You now report to ${bob.subject}`,
      actor: { principalId: company.owner.principalId, name: `Owner ${company.owner.subject}` },
      path: 'structure',
      readAt: null,
    });
    expect(await textsOf(w, company, anna)).toEqual([
      `${mia.subject} no longer reports to you; they report to ${bob.subject} now`,
    ]);
    expect(await textsOf(w, company, bob)).toEqual([`${mia.subject} now reports to you`]);
    expect(await textsOf(w, company, company.owner)).toEqual([]);
  });

  it('spares the actor when they are one of the managers, and says nothing for a title alone', async () => {
    const { company, anna, mia } = await team();
    await move(company, anna, mia.principalId, company.owner.principalId);
    expect(await rowsOf(w.t.db, company.companyId)).toEqual([
      [mia.principalId, 'manager_changed', anna.principalId],
      [company.owner.principalId, 'report_added', anna.principalId],
    ]);
    const titled = await as(w, company.owner)('PUT', positionPath(company, mia.principalId), {
      title: 'Lead',
    });
    expect(titled.status).toBe(200);
    await move(company, company.owner, mia.principalId, company.owner.principalId);
    expect(await rowsOf(w.t.db, company.companyId)).toHaveLength(2);
  });

  it('tells someone moved to the top that they stand there', async () => {
    const { company, anna, mia } = await team();
    await move(company, company.owner, mia.principalId, null);
    expect(await textsOf(w, company, mia)).toEqual(['You now stand at the top of the org chart']);
    expect(await textsOf(w, company, anna)).toEqual([`${mia.subject} no longer reports to you`]);
  });
});

describe('an agent moved on the chart', () => {
  it('tells the old and the new manager, and never the agent', async () => {
    const { company, anna, bob } = await team();
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Night Shift',
      reportsToPrincipalId: anna.principalId,
    });
    await move(company, company.owner, agent.principalId, bob.principalId);
    expect(await textsOf(w, company, anna)).toEqual([
      `Night Shift no longer reports to you; they report to ${bob.subject} now`,
    ]);
    expect(await textsOf(w, company, bob)).toEqual(['Night Shift now reports to you']);
    const recipients = (await rowsOf(w.t.db, company.companyId)).map(([recipient]) => recipient);
    expect(recipients).not.toContain(agent.principalId);
  });
});

describe('the reports of someone who leaves the chart', () => {
  it('hear of their new manager, and so does the manager who takes them, by whoever removed the leaver', async () => {
    const { company, anna, bob, mia } = await team();
    expect((await as(w, bob)('DELETE', memberPath(company, anna))).status).toBe(204);
    expect(await textsOf(w, company, mia)).toEqual([`You now report to Owner ${company.owner.subject}`]);
    expect(await textsOf(w, company, company.owner)).toEqual([`${mia.subject} now reports to you`]);
    // The leaver hears of their removal, not of the reports they lost.
    expect((await rowsOf(w.t.db, company.companyId)).filter(([to]) => to === anna.principalId)).toEqual([
      [anna.principalId, 'membership_removed', bob.principalId],
    ]);
  });
});
