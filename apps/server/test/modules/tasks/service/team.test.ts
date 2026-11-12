import { tenant } from '@mwc/db';
import { createTestApp, seedAgent, seedCompany, seedMember, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rosterOf } from '../../../../src/modules/tasks/service/team.ts';

// What the routes cannot reach: the roster's answers for a chart read straight from the tables. The principals' names
// are the org module's (test/modules/org/service/names.test.ts).
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('rosterOf', () => {
  it('knows who is on the chart, who is a person, and who leads a team', async () => {
    const { company, owner } = await seedCompany(t.db);
    const lead = await seedAgent(t.db, company.id, { reportsTo: owner.principal.id });
    const off = await seedMember(t.db, company.id, { status: 'removed', reportsTo: null });
    const roster = await rosterOf(await tenant(t.db, company.id));
    expect([roster.onChart(lead.principal.id), roster.onChart(off.principal.id)]).toEqual([true, false]);
    expect([roster.isPerson(owner.principal.id), roster.isPerson(lead.principal.id)]).toEqual([true, false]);
    expect(roster.team(lead.principal.id)).toEqual({
      lead: lead.principal.id,
      leadPeople: [owner.principal.id],
    });
    expect(roster.leadPerson(lead.principal.id)).toBe(owner.principal.id);
  });
});
