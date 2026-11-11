import { memberships, tenant } from '@mwc/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { joinAs, MY_INBOX, myInboxOf } from '../../../fixtures/inbox.ts';
import { as } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld, bearer, seedApiKey } from '../../../fixtures/platform/auth.ts';
import { makeFlow, makeTask, stepOf, type TeamCompany, teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/** One person in two companies: Acme's owner, also a member of Globex placed under Globex's owner. */
describe('GET /api/me/inbox: across the caller’s companies', () => {
  let acme: TeamCompany;
  let globex: TeamCompany;
  let inGlobex: Awaited<ReturnType<typeof joinAs>>;
  beforeAll(async () => {
    acme = await teamCompany(w);
    globex = await teamCompany(w);
    inGlobex = await joinAs(w.t.db, globex, acme.owner, 'member', globex.owner.principalId);
    const acmeFlow = await makeFlow(w, acme);
    await makeTask(w, acme, acme.manager, {
      flowId: acmeFlow.id,
      stepId: stepOf(acmeFlow, 'Approve').id,
      title: 'Acme sign-off',
    });
    const steps = [{ name: 'Approve', kind: 'signoff', assigneePrincipalId: inGlobex.principalId }];
    const globexFlow = await makeFlow(w, globex, { steps, name: 'Globex delivery' });
    await makeTask(w, globex, globex.manager, {
      flowId: globexFlow.id,
      stepId: stepOf(globexFlow, 'Approve').id,
      title: 'Globex sign-off',
      priority: 'urgent',
    });
  });

  it('lists what needs the caller in every company, the most urgent first, each with its company, and the counts', async () => {
    const mine = await myInboxOf(w, acme.owner);
    expect(mine.items.map((item) => [item.title, item.company.id, item.subtitle])).toEqual([
      ['Globex sign-off', globex.companyId, 'Globex delivery · Approve'],
      ['Acme sign-off', acme.companyId, 'DEVBOX delivery · Approve'],
    ]);
    expect(mine.items[1]?.actions).toEqual(expect.arrayContaining(['approve', 'send_back']));
    // In Globex the caller is a member at the step and leads nothing; its only step has nowhere to send back to.
    expect(mine.items[0]?.actions).toEqual(['approve']);
    expect(mine.count).toBe(2);
    expect(mine.companies.map((company) => [company.id, company.count])).toEqual(
      expect.arrayContaining([
        [acme.companyId, 1],
        [globex.companyId, 1],
      ]),
    );
    const count = await as(w, acme.owner)('GET', `${MY_INBOX}/count`);
    expect(count.status).toBe(200);
    expect(count.body).toMatchObject({ count: 2 });
  });

  it("leaves out a company whose membership is not active, and another person's items", async () => {
    const globexTenant = await tenant(w.t.db, globex.companyId);
    await globexTenant.update(
      memberships,
      { status: 'suspended' },
      eq(memberships.id, inGlobex.membershipId),
    );
    const mine = await myInboxOf(w, acme.owner);
    expect(mine.items.map((item) => item.title)).toEqual(['Acme sign-off']);
    expect(mine.companies.map((company) => company.id)).toEqual([acme.companyId]);
    await globexTenant.update(memberships, { status: 'active' }, eq(memberships.id, inGlobex.membershipId));
    expect((await myInboxOf(w, globex.member)).items).toEqual([]);
    expect(await myInboxOf(w, globex.owner)).toMatchObject({ items: [], count: 0 });
  });

  it("is the key's own company only for an API key, and refuses no credential", async () => {
    const { key } = await seedApiKey(w.t.db, {
      companyId: acme.companyId,
      principalId: acme.owner.principalId,
    });
    const res = await w.t.app.request(MY_INBOX, { headers: bearer(key) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { title: string }[]; companies: { id: string }[] };
    expect(body.items.map((item) => item.title)).toEqual(['Acme sign-off']);
    expect(body.companies.map((company) => company.id)).toEqual([acme.companyId]);
    expect((await w.t.app.request(MY_INBOX)).status).toBe(401);
    expect((await w.t.app.request(`${MY_INBOX}/count`)).status).toBe(401);
  });
});
