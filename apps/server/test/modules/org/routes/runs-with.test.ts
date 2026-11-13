import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import {
  type AgentDetailView,
  agentsPath,
  makeAgent,
  PROFILES,
  placedMember,
  seedProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

// What an agent runs (since 2026-11-10, docs/subscriptions.md "Model and effort"): its access profile's model and effort,
// shown on its views as `runsWith` (null without a profile), and following the profile when its owner changes it.

let w: AuthWorld;
let company: MembersCompany;
let admin: Person;
beforeAll(async () => {
  w = await authWorld();
  company = await membersCompany(w);
  admin = await placedMember(w, company, 'admin');
});
afterAll(() => w.t.close());

const listed = async (person: Person) =>
  ((await as(w, person)('GET', agentsPath(company))).body as { agents: AgentDetailView[] }).agents;

describe("an agent's runsWith", () => {
  it("is its profile's model, effort and provider on its own view, the list and the answer to a change", async () => {
    const work = await seedProfile(w.t.db, admin.userId, { model: 'claude-sonnet-5-5', effort: 'max' });
    const coder = await makeAgent(w, company, admin, { name: 'Sonnet coder', profileId: work.id });
    const runsWith = { model: 'claude-sonnet-5-5', effort: 'max', provider: 'claude' };
    expect(coder.runsWith).toEqual(runsWith);
    const read = await as(w, company.owner)('GET', agentsPath(company, coder.id));
    expect(read.body).toMatchObject({ runsWith });
    expect((await listed(company.owner)).find((agent) => agent.id === coder.id)?.runsWith).toEqual(runsWith);
    const renamed = await as(w, admin)('PATCH', agentsPath(company, coder.id), { name: 'Renamed coder' });
    expect(renamed.body).toMatchObject({ runsWith });
  });

  it("shows the provider's defaults as nulls, and none without a profile", async () => {
    const codex = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const agent = await makeAgent(w, company, admin, {
      name: 'Codex coder',
      harness: 'codex',
      profileId: codex.id,
    });
    expect(agent.runsWith).toEqual({ model: null, effort: null, provider: 'openai' });
    const bare = await makeAgent(w, company, admin, { name: 'No profile', profileId: null });
    expect(bare).toMatchObject({ profile: null, runsWith: null });
  });

  it('follows its profile when the owner changes the model or the effort', async () => {
    const created = await as(w, admin)('POST', PROFILES, {
      name: 'Changing',
      parts: { openai: { model: 'gpt-6.1-sol', effort: 'high' } },
    });
    const profileId = (created.body as { id: string }).id;
    const agent = await makeAgent(w, company, admin, { name: 'Follower', harness: 'codex', profileId });
    expect(agent.runsWith).toEqual({ model: 'gpt-6.1-sol', effort: 'high', provider: 'openai' });
    const changed = await as(w, admin)('PATCH', `${PROFILES}/${profileId}`, {
      parts: { openai: { model: 'gpt-6-astra', effort: 'ultra' } },
    });
    expect(changed.status).toBe(200);
    const read = await as(w, company.owner)('GET', agentsPath(company, agent.id));
    expect(read.body).toMatchObject({
      runsWith: { model: 'gpt-6-astra', effort: 'ultra', provider: 'openai' },
    });
  });
});
