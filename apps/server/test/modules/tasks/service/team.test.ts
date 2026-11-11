import { principals, tenant } from '@mwc/db';
import { createTestApp, seedAgent, seedCompany, seedMember, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tasksRepo } from '../../../../src/modules/tasks/repo.ts';
import { namesOf, rosterOf, SOMEONE } from '../../../../src/modules/tasks/service/team.ts';

// What the routes cannot reach: a principal that is neither an agent nor a person (none is made without one), and the
// roster's answers for a chart read straight from the tables.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('namesOf', () => {
  it('names agents, people by display name or email, and anyone else Someone', async () => {
    const { company, owner, tenant: scoped } = await seedCompany(t.db, { owner: { displayName: 'Olga' } });
    const agent = await seedAgent(t.db, company.id, { name: 'SLOP BOX', slug: 'slop-box', reportsTo: null });
    const nameless = await seedMember(t.db, company.id, {
      displayName: null,
      email: 'ann@acme.test',
      reportsTo: null,
    });
    const [bare] = await scoped.insert(principals, { kind: 'person' }).returning();
    const names = await namesOf(t.db, tasksRepo, await tenant(t.db, company.id), [
      owner.principal.id,
      agent.principal.id,
      nameless.principal.id,
      bare?.id,
      null,
    ]);
    expect(names(owner.principal.id)).toMatchObject({ kind: 'person', name: 'Olga', slug: null });
    expect(names(agent.principal.id)).toMatchObject({ kind: 'agent', name: 'SLOP BOX', slug: 'slop-box' });
    expect(names(nameless.principal.id).name).toBe('ann@acme.test');
    expect(names(bare?.id as string)).toEqual({
      principalId: bare?.id,
      kind: 'person',
      name: SOMEONE,
      slug: null,
    });
  });
});

describe('rosterOf', () => {
  it('knows who is on the chart, who is a person, and who leads a team', async () => {
    const { company, owner } = await seedCompany(t.db);
    const lead = await seedAgent(t.db, company.id, { reportsTo: owner.principal.id });
    const off = await seedMember(t.db, company.id, { status: 'removed', reportsTo: null });
    const roster = await rosterOf(await tenant(t.db, company.id));
    expect([roster.onChart(lead.principal.id), roster.onChart(off.principal.id)]).toEqual([true, false]);
    expect([roster.isPerson(owner.principal.id), roster.isPerson(lead.principal.id)]).toEqual([true, false]);
    expect(roster.team(lead.principal.id)).toEqual({ leadPeople: [owner.principal.id] });
    expect(roster.leadPerson(lead.principal.id)).toBe(owner.principal.id);
  });
});
